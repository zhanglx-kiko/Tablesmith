import type { SheetData } from '../types';
import { parseNumericCell } from '../utils/numberUtils';
import { formatNumber } from './import/cellText';

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
    };
  }

  // 1. Filter rows
  const sourceRows = sheet.rows.filter((row) => {
    if (filterIdx >= 0 && filterValue && filterValue !== '__ALL__') {
      return String(row[filterIdx] ?? '').trim() === filterValue;
    }
    return true;
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

  for (const row of sourceRows) {
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
    }
    const rowMap = matrix.get(compositeRowKey)!;
    if (!rowMap.has(cKey)) {
      rowMap.set(cKey, []);
    }
    rowMap.get(cKey)!.push(rawVal);
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
  const pushRow = (labels: string[], cells: { raw: string; display: string | null }[]) => {
    resultRows.push([...labels, ...cells.map((c) => c.raw)]);
    resultDisplay.push([...labels.map(() => null), ...cells.map((c) => c.display)]);
  };

  for (const rKey of sortedRowKeys) {
    const meta = rowMetaMap.get(rKey)!;
    const rTotal = rowTotals.get(rKey) ?? null;
    const cells = sortedColKeys.map((cKey) => cell(cellAgg.get(rKey)?.get(cKey) ?? null, baseFor(rTotal, colTotals.get(cKey) ?? null)));
    if (withRowTotal) cells.push(cell(rTotal, valueMode === 'percent_row' ? rTotal : baseFor(rTotal, grandTotal)));
    pushRow(twoLevel ? [meta.primary, meta.secondary ?? ''] : [meta.primary], cells);
  }

  if (showColTotal) {
    const cells = sortedColKeys.map((cKey) => {
      const cTotal = colTotals.get(cKey) ?? null;
      return cell(cTotal, valueMode === 'percent_col' ? cTotal : baseFor(grandTotal, cTotal));
    });
    if (withRowTotal) cells.push(cell(grandTotal, valueMode === 'raw' ? null : grandTotal));
    pushRow(twoLevel ? [GRAND_TOTAL, ''] : [GRAND_TOTAL], cells);
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
  };
}
