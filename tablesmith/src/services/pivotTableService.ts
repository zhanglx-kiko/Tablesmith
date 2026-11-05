import type { SheetData } from '../types';
import { parseNumericCell } from '../utils/numberUtils';

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

  // Helper: numeric array aggregation
  const aggregate = (vals: (string | number)[]): number => {
    if (!vals || vals.length === 0) return 0;
    if (aggType === 'count') return vals.length;
    if (aggType === 'distinct') return new Set(vals.map(String)).size;

    const nums = vals
      .map((v) => parseNumericCell(v))
      .filter((n) => !isNaN(n));

    if (nums.length === 0) return 0;

    switch (aggType) {
      case 'sum':
        return Number(nums.reduce((a, b) => a + b, 0).toFixed(2));
      case 'avg': {
        const sum = nums.reduce((a, b) => a + b, 0);
        return Number((sum / nums.length).toFixed(2));
      }
      case 'max':
        return Math.max(...nums);
      case 'min':
        return Math.min(...nums);
      default:
        return 0;
    }
  };

  // Pre-calculate raw aggregates for each cell and row totals
  // rawMatrix: compositeRowKey -> colKey -> aggregateNumber
  const rawMatrix = new Map<string, Map<string, number>>();
  const rawRowTotals = new Map<string, number>();
  const rawColTotals = new Map<string, (string | number)[]>();
  sortedColKeys.forEach((c) => rawColTotals.set(c, []));
  const rawAllVals: (string | number)[] = [];

  for (const rKey of sortedRowKeys) {
    const rowMap = matrix.get(rKey)!;
    const colAggs = new Map<string, number>();
    const rowAllVals: (string | number)[] = [];

    for (const cKey of sortedColKeys) {
      const vals = rowMap.get(cKey) || [];
      const aggVal = vals.length > 0 ? aggregate(vals) : 0;
      colAggs.set(cKey, aggVal);

      if (vals.length > 0) {
        rowAllVals.push(...vals);
        rawColTotals.get(cKey)!.push(...vals);
        rawAllVals.push(...vals);
      }
    }

    rawMatrix.set(rKey, colAggs);
    rawRowTotals.set(rKey, rowAllVals.length > 0 ? aggregate(rowAllVals) : 0);
  }

  const grandTotal = rawAllVals.length > 0 ? aggregate(rawAllVals) : 0;

  // Sorting rows
  if (sortOrder === 'dim_asc') {
    sortedRowKeys.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  } else if (sortOrder === 'dim_desc') {
    sortedRowKeys.sort((a, b) => b.localeCompare(a, 'zh-CN'));
  } else if (sortOrder === 'val_desc') {
    sortedRowKeys.sort((a, b) => (rawRowTotals.get(b) ?? 0) - (rawRowTotals.get(a) ?? 0));
  } else if (sortOrder === 'val_asc') {
    sortedRowKeys.sort((a, b) => (rawRowTotals.get(a) ?? 0) - (rawRowTotals.get(b) ?? 0));
  }

  // Pre-calculate column aggregated totals
  const colAggregates = new Map<string, number>();
  for (const cKey of sortedColKeys) {
    const colVals = rawColTotals.get(cKey) || [];
    colAggregates.set(cKey, colVals.length > 0 ? aggregate(colVals) : 0);
  }

  // Formatter according to valueMode
  let minVal = Infinity;
  let maxVal = -Infinity;

  const formatCellValue = (val: number, rowTot: number, colTot: number): string => {
    if (val === 0) return '-';
    if (val < minVal) minVal = val;
    if (val > maxVal) maxVal = val;

    switch (valueMode) {
      case 'percent_total': {
        if (!grandTotal) return '0.00%';
        return `${((val / grandTotal) * 100).toFixed(2)}%`;
      }
      case 'percent_row': {
        if (!rowTot) return '0.00%';
        return `${((val / rowTot) * 100).toFixed(2)}%`;
      }
      case 'percent_col': {
        if (!colTot) return '0.00%';
        return `${((val / colTot) * 100).toFixed(2)}%`;
      }
      case 'raw':
      default:
        return String(val);
    }
  };

  // 2. Build headers
  const headers: string[] = [];
  if (subRowIdx >= 0 && subRowField) {
    headers.push(rowField, subRowField);
  } else {
    headers.push(rowField);
  }
  headers.push(...sortedColKeys);
  if (showRowTotal) {
    headers.push('总计汇总');
  }

  // 3. Build data rows
  const resultRows: string[][] = [];

  for (const rKey of sortedRowKeys) {
    const meta = rowMetaMap.get(rKey)!;
    const rowCells: string[] = [];
    if (subRowIdx >= 0 && subRowField) {
      rowCells.push(meta.primary, meta.secondary || '-');
    } else {
      rowCells.push(meta.primary);
    }

    const colAggs = rawMatrix.get(rKey)!;
    const rTotal = rawRowTotals.get(rKey) ?? 0;

    for (const cKey of sortedColKeys) {
      const cellVal = colAggs.get(cKey) ?? 0;
      const cTotal = colAggregates.get(cKey) ?? 0;
      rowCells.push(formatCellValue(cellVal, rTotal, cTotal));
    }

    if (showRowTotal) {
      if (valueMode === 'percent_total') {
        const pct = grandTotal ? `${((rTotal / grandTotal) * 100).toFixed(2)}%` : '0.00%';
        rowCells.push(pct);
      } else if (valueMode === 'percent_row') {
        rowCells.push('100.00%');
      } else if (valueMode === 'percent_col') {
        const pct = grandTotal ? `${((rTotal / grandTotal) * 100).toFixed(2)}%` : '0.00%';
        rowCells.push(pct);
      } else {
        rowCells.push(String(rTotal));
      }
    }

    resultRows.push(rowCells);
  }

  // 4. Grand Total row at the bottom
  if (showColTotal) {
    const totalRow: string[] = [];
    if (subRowIdx >= 0 && subRowField) {
      totalRow.push('总计汇总', '-');
    } else {
      totalRow.push('总计汇总');
    }

    for (const cKey of sortedColKeys) {
      const cTotal = colAggregates.get(cKey) ?? 0;
      if (valueMode === 'percent_total') {
        const pct = grandTotal ? `${((cTotal / grandTotal) * 100).toFixed(2)}%` : '0.00%';
        totalRow.push(pct);
      } else if (valueMode === 'percent_col') {
        totalRow.push('100.00%');
      } else if (valueMode === 'percent_row') {
        const pct = grandTotal ? `${((cTotal / grandTotal) * 100).toFixed(2)}%` : '0.00%';
        totalRow.push(pct);
      } else {
        totalRow.push(String(cTotal));
      }
    }

    if (showRowTotal) {
      if (valueMode === 'percent_total' || valueMode === 'percent_row' || valueMode === 'percent_col') {
        totalRow.push('100.00%');
      } else {
        totalRow.push(String(grandTotal));
      }
    }

    resultRows.push(totalRow);
  }

  if (minVal === Infinity) minVal = 0;
  if (maxVal === -Infinity) maxVal = 0;

  const aggLabelMap: Record<PivotAggType, string> = {
    sum: '求和',
    avg: '均值',
    count: '计数',
    distinct: '去重数',
    max: '最大值',
    min: '最小值',
  };

  return {
    sheet: {
      name: `${sheet.name}_透视(${aggLabelMap[aggType]}_${valueField})`,
      headers,
      rows: resultRows,
    },
    minVal,
    maxVal,
    hasColDimension: colIdx >= 0,
    rowKeys: sortedRowKeys,
    colKeys: sortedColKeys,
  };
}
