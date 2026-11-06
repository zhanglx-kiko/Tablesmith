import type { SheetData } from '../types';
import { parseNumericCell } from '../utils/numberUtils';
import { formatNumber } from './import/cellText';
import { selectRows } from './dataProcessService';

/** Excel's (zh-CN) names for value fields and the grand total. */
const AGG_LABEL: Record<PivotAggType, string> = {
  sum: '求和项',
  avg: '平均值项',
  count: '计数项',
  distinct: '非重复计数项',
  max: '最大值项',
  min: '最小值项',
};
const GRAND_TOTAL = '总计';

export type PivotAggType = 'sum' | 'avg' | 'count' | 'distinct' | 'max' | 'min';
export type PivotValueMode = 'raw' | 'percent_total' | 'percent_row' | 'percent_col';
export type PivotSortOrder = 'default' | 'dim_asc' | 'dim_desc' | 'val_asc' | 'val_desc';

export interface PivotConfig {
  rowField: string;
  subRowField?: string;        // Optional 2nd level row hierarchy (e.g. 部门 > 岗位)
  colField?: string;           // Optional column cross dimension
  valueField: string;          // Measure column
  aggType: PivotAggType;       // Aggregation function
  valueMode?: PivotValueMode;  // Display mode (Raw / % of Total / % of Row / % of Col)
  filterField?: string;        // Optional filter field
  filterValue?: string;        // Filter value ('__ALL__' means no filter)
  sortOrder?: PivotSortOrder;  // Row sort order
  showRowTotal?: boolean;      // Toggle row total column (default: true)
  showColTotal?: boolean;      // Toggle col total row (default: true)
}

export interface PivotCellHeatmap {
  rowIndex: number;
  colIndex: number;
  ratio: number; // 0 to 1 for heatmap color grading
}

export interface PivotTableOutput {
  sheet: SheetData;
  minVal: number;
  maxVal: number;
  hasColDimension: boolean;
  rowKeys: string[];
  colKeys: string[];
  /**
   * Source row indices behind each output cell (same shape as `sheet.rows`), in source
   * order; null for label cells and cells with no source rows. Like Excel's Show Details,
   * a cell lists every row in its group (including rows whose value is blank or text) and
   * totals list every row of their row, column or the whole (filtered) table.
   */
  sources: (number[] | null)[][];
}

/**
 * Excel-grade Pivot Table Matrix Generator
 */
export function generatePivotTable(sheet: SheetData, config: PivotConfig): SheetData {
  const result = generatePivotTableWithMeta(sheet, config);
  return result.sheet;
}

export function generatePivotTableWithMeta(sheet: SheetData, config: PivotConfig): PivotTableOutput {
  const {
    rowField,
    subRowField,
    colField,
    valueField,
    aggType,
    valueMode = 'raw',
    filterField,
    filterValue,
    sortOrder = 'default',
    showRowTotal = true,
    showColTotal = true,
  } = config;

  const rowIdx = sheet.headers.indexOf(rowField);
  const subRowIdx = subRowField && subRowField !== '__NONE__' ? sheet.headers.indexOf(subRowField) : -1;
  const valIdx = sheet.headers.indexOf(valueField);
  const colIdx = colField && colField !== '__NONE__' ? sheet.headers.indexOf(colField) : -1;
  const filterIdx = filterField && filterField !== '__NONE__' ? sheet.headers.indexOf(filterField) : -1;

  if (rowIdx < 0 || valIdx < 0) {
    return {
      sheet,
      minVal: 0,
      maxVal: 0,
      hasColDimension: false,
      rowKeys: [],
      colKeys: [],
      sources: [],
    };
  }

  // 1. Filter rows (kept as indices so each cell can list its source rows)
  const sourceIndices: number[] = [];
  sheet.rows.forEach((row, i) => {
    if (filterIdx < 0 || !filterValue || filterValue === '__ALL__' || String(row[filterIdx] ?? '').trim() === filterValue) {
      sourceIndices.push(i);
    }
  });

  // Map: compositeRowKey -> colKey -> raw values (as strings/numbers)
  // Store row labels mapping for multi-level hierarchy
  interface RowMeta {
    primary: string;
    secondary?: string;
  }
  const rowMetaMap = new Map<string, RowMeta>();
  const colKeySet = new Set<string>();
  const matrix = new Map<string, Map<string, (string | number)[]>>();
  /** compositeRowKey -> colKey -> source row indices, parallel to `matrix`. */
  const rowsOf = new Map<string, Map<string, number[]>>();

  for (const srcIndex of sourceIndices) {
    const row = sheet.rows[srcIndex];
    const rKeyPrimary = String(row[rowIdx] ?? '未知').trim() || '空值';
    const rKeySecondary = subRowIdx >= 0 ? String(row[subRowIdx] ?? '无').trim() || '空值' : undefined;
    const compositeRowKey = rKeySecondary ? `${rKeyPrimary} ❯ ${rKeySecondary}` : rKeyPrimary;

    const cKey = colIdx >= 0 ? String(row[colIdx] ?? '全部').trim() || '空值' : '数值汇总';
    const rawVal = row[valIdx];

    colKeySet.add(cKey);
    if (!rowMetaMap.has(compositeRowKey)) {
      rowMetaMap.set(compositeRowKey, { primary: rKeyPrimary, secondary: rKeySecondary });
    }

    if (!matrix.has(compositeRowKey)) {
      matrix.set(compositeRowKey, new Map());
      rowsOf.set(compositeRowKey, new Map());
    }
    const rowMap = matrix.get(compositeRowKey)!;
    const idxMap = rowsOf.get(compositeRowKey)!;
    if (!rowMap.has(cKey)) {
      rowMap.set(cKey, []);
      idxMap.set(cKey, []);
    }
    rowMap.get(cKey)!.push(rawVal);
    idxMap.get(cKey)!.push(srcIndex);
  }

  const sortedColKeys = Array.from(colKeySet);
  let sortedRowKeys = Array.from(matrix.keys());

  /**
   * Aggregate like Excel: null means no value to show (the cell stays blank). Sum /
   * average / max / min read numbers with parseNumericCell ("1,200", "$30", "(5)", "12%"
   * as 0.12) and skip text.
   */
  const aggregate = (vals: (string | number)[]): number | null => {
    const filled = vals.filter((v) => String(v ?? '').trim() !== '');
    if (filled.length === 0) return null;
    if (aggType === 'count') return filled.length;
    if (aggType === 'distinct') return new Set(filled.map((v) => String(v).trim())).size;
    const nums = filled.map(parseNumericCell).filter((n) => !Number.isNaN(n));
    if (nums.length === 0) return aggType === 'sum' ? 0 : null;
    switch (aggType) {
      case 'sum':
        return nums.reduce((a, b) => a + b, 0);
      case 'avg':
        return nums.reduce((a, b) => a + b, 0) / nums.length;
      case 'max':
        return nums.reduce((a, b) => (b > a ? b : a), -Infinity);
      case 'min':
        return nums.reduce((a, b) => (b < a ? b : a), Infinity);
      default:
        return null;
    }
  };

  // Aggregate each cell from its source values, and totals from all values of the row,
  // column or table (an average of averages would be wrong).
  const cellAgg = new Map<string, Map<string, number | null>>();
  const rowTotals = new Map<string, number | null>();
  const colValues = new Map<string, (string | number)[]>(sortedColKeys.map((c) => [c, []]));
  const allValues: (string | number)[] = [];
  for (const rKey of sortedRowKeys) {
    const rowMap = matrix.get(rKey)!;
    const aggs = new Map<string, number | null>();
    const rowValues: (string | number)[] = [];
    for (const cKey of sortedColKeys) {
      const vals = rowMap.get(cKey) ?? [];
      aggs.set(cKey, vals.length ? aggregate(vals) : null);
      rowValues.push(...vals);
      colValues.get(cKey)!.push(...vals);
      allValues.push(...vals);
    }
    cellAgg.set(rKey, aggs);
    rowTotals.set(rKey, aggregate(rowValues));
  }
  const colTotals = new Map<string, number | null>(sortedColKeys.map((c) => [c, aggregate(colValues.get(c) ?? [])]));
  const grandTotal = aggregate(allValues);

  if (sortOrder === 'dim_asc') {
    sortedRowKeys.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  } else if (sortOrder === 'dim_desc') {
    sortedRowKeys.sort((a, b) => b.localeCompare(a, 'zh-CN', { numeric: true }));
  } else if (sortOrder === 'val_desc') {
    sortedRowKeys.sort((a, b) => (rowTotals.get(b) ?? -Infinity) - (rowTotals.get(a) ?? -Infinity));
  } else if (sortOrder === 'val_asc') {
    sortedRowKeys.sort((a, b) => (rowTotals.get(a) ?? Infinity) - (rowTotals.get(b) ?? Infinity));
  }

  let minVal = Infinity;
  let maxVal = -Infinity;

  /**
   * One output cell: raw text keeps the exact number; percentages store the fraction
   * (0.1234) as raw and "12.34%" as display, like an Excel cell formatted as percent.
   */
  const cell = (val: number | null, base: number | null): { raw: string; display: string | null } => {
    if (val === null) return { raw: '', display: null };
    if (valueMode === 'raw') {
      if (val < minVal) minVal = val;
      if (val > maxVal) maxVal = val;
      return { raw: formatNumber(val), display: null };
    }
    if (base === null || base === 0) return { raw: '', display: null };
    const frac = val / base;
    if (frac < minVal) minVal = frac;
    if (frac > maxVal) maxVal = frac;
    return { raw: formatNumber(frac), display: `${(frac * 100).toFixed(2)}%` };
  };
  /** Denominator for a body cell under the value mode. */
  const baseFor = (rTotal: number | null, cTotal: number | null): number | null =>
    valueMode === 'percent_total' ? grandTotal : valueMode === 'percent_row' ? rTotal : valueMode === 'percent_col' ? cTotal : null;

  const hasCols = colIdx >= 0;
  const twoLevel = subRowIdx >= 0 && Boolean(subRowField);
  const valueLabel = `${AGG_LABEL[aggType]}:${valueField}`;
  // Without a column field the single value column is the total; no extra total column.
  const withRowTotal = showRowTotal && hasCols;

  const headers: string[] = twoLevel ? [rowField, subRowField as string] : [rowField];
  headers.push(...(hasCols ? sortedColKeys : [valueLabel]));
  if (withRowTotal) headers.push(GRAND_TOTAL);

  const resultRows: string[][] = [];
  const resultDisplay: (string | null)[][] = [];
  const sources: (number[] | null)[][] = [];
  const pushRow = (labels: string[], cells: { raw: string; display: string | null }[], cellSources: number[][]) => {
    resultRows.push([...labels, ...cells.map((c) => c.raw)]);
    resultDisplay.push([...labels.map(() => null), ...cells.map((c) => c.display)]);
    sources.push([...labels.map(() => null), ...cellSources.map((ids) => (ids.length ? ids : null))]);
  };
  const ascending = (a: number, b: number) => a - b;
  const rowSources = (rKey: string): number[] =>
    sortedColKeys.flatMap((cKey) => rowsOf.get(rKey)?.get(cKey) ?? []).sort(ascending);
  const colSources = (cKey: string): number[] =>
    sortedRowKeys.flatMap((rKey) => rowsOf.get(rKey)?.get(cKey) ?? []).sort(ascending);

  for (const rKey of sortedRowKeys) {
    const meta = rowMetaMap.get(rKey)!;
    const rTotal = rowTotals.get(rKey) ?? null;
    const cells = sortedColKeys.map((cKey) => cell(cellAgg.get(rKey)?.get(cKey) ?? null, baseFor(rTotal, colTotals.get(cKey) ?? null)));
    const cellSources = sortedColKeys.map((cKey) => rowsOf.get(rKey)?.get(cKey) ?? []);
    if (withRowTotal) {
      cells.push(cell(rTotal, valueMode === 'percent_row' ? rTotal : baseFor(rTotal, grandTotal)));
      cellSources.push(rowSources(rKey));
    }
    pushRow(twoLevel ? [meta.primary, meta.secondary ?? ''] : [meta.primary], cells, cellSources);
  }

  if (showColTotal) {
    const cells = sortedColKeys.map((cKey) => {
      const cTotal = colTotals.get(cKey) ?? null;
      return cell(cTotal, valueMode === 'percent_col' ? cTotal : baseFor(grandTotal, cTotal));
    });
    const cellSources = sortedColKeys.map(colSources);
    if (withRowTotal) {
      cells.push(cell(grandTotal, valueMode === 'raw' ? null : grandTotal));
      cellSources.push(sourceIndices);
    }
    pushRow(twoLevel ? [GRAND_TOTAL, ''] : [GRAND_TOTAL], cells, cellSources);
  }

  if (minVal === Infinity) minVal = 0;
  if (maxVal === -Infinity) maxVal = 0;

  const hasDisplay = resultDisplay.some((r) => r.some((d) => d !== null));
  return {
    sheet: {
      name: `${sheet.name}_透视(${AGG_LABEL[aggType]}_${valueField})`,
      headers,
      rows: resultRows,
      ...(hasDisplay ? { display: resultDisplay } : {}),
    },
    minVal,
    maxVal,
    hasColDimension: colIdx >= 0,
    rowKeys: sortedRowKeys,
    colKeys: sortedColKeys,
    sources,
  };
}

export interface PivotCellDetail {
  /** The source rows behind the cell, all columns, in source order. */
  sheet: SheetData;
  /** What the cell stands for, e.g. "region=East · period_id=2024-01". */
  label: string;
}

/**
 * Excel's Show Details (double-click a PivotTable value): the source rows behind one
 * output cell of `generatePivotTable(source, config)`. Null for label cells and blank
 * cells. Values, display text and formulas come from the source unchanged.
 */
export function pivotCellDetail(source: SheetData, config: PivotConfig, row: number, col: number): PivotCellDetail | null {
  const out = generatePivotTableWithMeta(source, config);
  const ids = out.sources[row]?.[col];
  // A blank cell (e.g. a percentage of a zero total) shows nothing to explain.
  if (!ids || (out.sheet.rows[row]?.[col] ?? '') === '') return null;
  const headers = out.sheet.headers;
  const parts: string[] = [];
  const rowLabels = out.sheet.rows[row] ?? [];
  const nLabels = config.subRowField && config.subRowField !== '__NONE__' ? 2 : 1;
  if (rowLabels[0] !== GRAND_TOTAL) {
    for (let i = 0; i < nLabels; i += 1) parts.push(`${headers[i]}=${rowLabels[i]}`);
  }
  if (out.hasColDimension && headers[col] !== GRAND_TOTAL) parts.push(`${config.colField}=${headers[col]}`);
  if (parts.length === 0) parts.push(GRAND_TOTAL);
  if (config.filterField && config.filterField !== '__NONE__' && config.filterValue && config.filterValue !== '__ALL__') {
    parts.push(`${config.filterField}=${config.filterValue}`);
  }
  const label = parts.join(' · ');
  const sheet = selectRows(source, ids);
  return { sheet: { ...sheet, name: `${source.name}_明细(${label})` }, label };
}
