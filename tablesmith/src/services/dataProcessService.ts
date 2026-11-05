import type { SheetData } from '../types';
import { parseNumericCell } from '../utils/numberUtils';

export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'isEmpty'
  | 'isNotEmpty';

export interface FilterCondition {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string;
}

export interface ComputedColumnConfig {
  name: string;
  type: 'calc' | 'combine' | 'prefixSuffix';
  colA: string;
  colB?: string;
  operator?: '+' | '-' | '*' | '/';
  separator?: string;
  prefix?: string;
  suffix?: string;
}

/**
 * Remove duplicate rows.
 * If keyColumns are provided, duplicates are checked only on those columns.
 */
export function removeDuplicates(
  sheet: SheetData,
  keyColumns?: string[],
): { result: SheetData; removedCount: number } {
  const colIndices =
    keyColumns && keyColumns.length > 0
      ? keyColumns.map((col) => sheet.headers.indexOf(col)).filter((i) => i >= 0)
      : sheet.headers.map((_, i) => i);

  const seen = new Set<string>();
  const newRows: string[][] = [];
  let removedCount = 0;

  for (const row of sheet.rows) {
    const key = colIndices.map((i) => row[i] ?? '').join('___@@@___');
    if (seen.has(key)) {
      removedCount++;
    } else {
      seen.add(key);
      newRows.push(row);
    }
  }

  return {
    result: { ...sheet, rows: newRows },
    removedCount,
  };
}

/**
 * Remove rows where every cell is empty or only whitespace.
 */
export function removeEmptyRows(sheet: SheetData): { result: SheetData; removedCount: number } {
  const newRows = sheet.rows.filter((row) =>
    row.some((cell) => cell !== null && cell !== undefined && cell.trim() !== ''),
  );
  return {
    result: { ...sheet, rows: newRows },
    removedCount: sheet.rows.length - newRows.length,
  };
}

/**
 * Trim leading and trailing whitespace from every cell.
 */
export function trimWhitespace(sheet: SheetData): SheetData {
  const newRows = sheet.rows.map((row) =>
    row.map((cell) => (typeof cell === 'string' ? cell.trim() : cell)),
  );
  return { ...sheet, rows: newRows };
}

/**
 * Apply row filtering conditions.
 */
export function filterRows(
  sheet: SheetData,
  conditions: FilterCondition[],
  matchType: 'all' | 'any' = 'all',
): { result: SheetData; matchCount: number } {
  if (conditions.length === 0) {
    return { result: sheet, matchCount: sheet.rows.length };
  }

  const newRows = sheet.rows.filter((row) => {
    const testCondition = (c: FilterCondition): boolean => {
      const colIdx = sheet.headers.indexOf(c.column);
      if (colIdx < 0) return true;

      const cellVal = String(row[colIdx] ?? '').trim();
      const targetVal = c.value.trim();

      switch (c.operator) {
        case 'equals':
          return cellVal.toLowerCase() === targetVal.toLowerCase();
        case 'notEquals':
          return cellVal.toLowerCase() !== targetVal.toLowerCase();
        case 'contains':
          return cellVal.toLowerCase().includes(targetVal.toLowerCase());
        case 'notContains':
          return !cellVal.toLowerCase().includes(targetVal.toLowerCase());
        case 'isEmpty':
          return cellVal === '';
        case 'isNotEmpty':
          return cellVal !== '';
        case 'greaterThan': {
          const num = parseNumericCell(cellVal);
          const target = parseNumericCell(targetVal);
          return !isNaN(num) && !isNaN(target) && num > target;
        }
        case 'lessThan': {
          const num = parseNumericCell(cellVal);
          const target = parseNumericCell(targetVal);
          return !isNaN(num) && !isNaN(target) && num < target;
        }
        case 'greaterThanOrEqual': {
          const num = parseNumericCell(cellVal);
          const target = parseNumericCell(targetVal);
          return !isNaN(num) && !isNaN(target) && num >= target;
        }
        case 'lessThanOrEqual': {
          const num = parseNumericCell(cellVal);
          const target = parseNumericCell(targetVal);
          return !isNaN(num) && !isNaN(target) && num <= target;
        }
        default:
          return true;
      }
    };

    return matchType === 'all'
      ? conditions.every(testCondition)
      : conditions.some(testCondition);
  });

  return {
    result: { ...sheet, rows: newRows },
    matchCount: newRows.length,
  };
}

/**
 * Add a computed or derived column to the sheet.
 */
export function addComputedColumn(
  sheet: SheetData,
  config: ComputedColumnConfig,
): SheetData {
  if (!config.name || sheet.headers.includes(config.name)) {
    return sheet;
  }

  const idxA = sheet.headers.indexOf(config.colA);
  const idxB = config.colB ? sheet.headers.indexOf(config.colB) : -1;

  const newHeaders = [...sheet.headers, config.name];
  const newRows = sheet.rows.map((row) => {
    const valA = row[idxA] ?? '';
    const valB = idxB >= 0 ? row[idxB] ?? '' : '';

    let computedVal = '';

    if (config.type === 'calc') {
      const numA = parseNumericCell(valA);
      const numB = parseNumericCell(valB);
      if (!isNaN(numA) && !isNaN(numB)) {
        switch (config.operator) {
          case '+':
            computedVal = String(Number((numA + numB).toFixed(4)));
            break;
          case '-':
            computedVal = String(Number((numA - numB).toFixed(4)));
            break;
          case '*':
            computedVal = String(Number((numA * numB).toFixed(4)));
            break;
          case '/':
            computedVal = numB !== 0 ? String(Number((numA / numB).toFixed(4))) : '#DIV/0!';
            break;
          default:
            computedVal = '';
        }
      }
    } else if (config.type === 'combine') {
      const sep = config.separator ?? ' ';
      computedVal = `${valA}${sep}${valB}`;
    } else if (config.type === 'prefixSuffix') {
      const p = config.prefix ?? '';
      const s = config.suffix ?? '';
      computedVal = `${p}${valA}${s}`;
    }

    return [...row, computedVal];
  });

  return {
    ...sheet,
    headers: newHeaders,
    rows: newRows,
  };
}

/**
 * Delete specified columns from a sheet.
 */
export function deleteColumns(sheet: SheetData, colsToDelete: string[]): SheetData {
  const deleteSet = new Set(colsToDelete);
  const keepIndices: number[] = [];
  const newHeaders: string[] = [];

  sheet.headers.forEach((h, i) => {
    if (!deleteSet.has(h)) {
      keepIndices.push(i);
      newHeaders.push(h);
    }
  });

  const newRows = sheet.rows.map((row) => keepIndices.map((i) => row[i] ?? ''));

  return {
    ...sheet,
    headers: newHeaders,
    rows: newRows,
  };
}

// ---------------- 数据脱敏 (Data Masking) ----------------

export type MaskType = 'phone' | 'idcard' | 'name' | 'email' | 'all';

/**
 * Mask sensitive data in a specific column.
 */
export function maskColumnData(
  sheet: SheetData,
  targetColumn: string,
  maskType: MaskType,
): { result: SheetData; maskedCount: number } {
  const colIdx = sheet.headers.indexOf(targetColumn);
  if (colIdx < 0) return { result: sheet, maskedCount: 0 };

  let maskedCount = 0;

  const newRows = sheet.rows.map((row) => {
    const rawVal = row[colIdx];
    if (!rawVal || rawVal.trim() === '') return row;

    const val = rawVal.trim();
    let masked = val;

    switch (maskType) {
      case 'phone': {
        // e.g. 13812345678 -> 138****5678
        if (/^\d{11}$/.test(val)) {
          masked = val.slice(0, 3) + '****' + val.slice(7);
          maskedCount++;
        } else if (val.length >= 7) {
          const mid = Math.floor(val.length / 2);
          masked = val.slice(0, mid - 2) + '****' + val.slice(mid + 2);
          maskedCount++;
        }
        break;
      }
      case 'idcard': {
        // e.g. 18-digit ID: 110101199003072345 -> 110101********2345
        if (val.length === 18) {
          masked = val.slice(0, 6) + '********' + val.slice(14);
          maskedCount++;
        } else if (val.length >= 8) {
          masked = val.slice(0, 3) + '****' + val.slice(-4);
          maskedCount++;
        }
        break;
      }
      case 'name': {
        // e.g. 张三 -> 张* ; 李小龙 -> 李*龙 ; 诸葛孔明 -> 诸**明
        if (val.length === 2) {
          masked = val[0] + '*';
          maskedCount++;
        } else if (val.length === 3) {
          masked = val[0] + '*' + val[2];
          maskedCount++;
        } else if (val.length > 3) {
          masked = val[0] + '*'.repeat(val.length - 2) + val.slice(-1);
          maskedCount++;
        }
        break;
      }
      case 'email': {
        // e.g. user@domain.com -> u***r@domain.com
        const atIdx = val.indexOf('@');
        if (atIdx > 1) {
          const namePart = val.slice(0, atIdx);
          const domainPart = val.slice(atIdx);
          const maskedName =
            namePart.length <= 2
              ? namePart[0] + '*'
              : namePart[0] + '***' + namePart.slice(-1);
          masked = maskedName + domainPart;
          maskedCount++;
        }
        break;
      }
      case 'all': {
        masked = '******';
        maskedCount++;
        break;
      }
    }

    const updatedRow = [...row];
    updatedRow[colIdx] = masked;
    return updatedRow;
  });

  return {
    result: { ...sheet, rows: newRows },
    maskedCount,
  };
}

// ---------------- 多表合并与关联 (Join & Union) ----------------

/**
 * Horizontally merge (JOIN) two sheets based on a shared key column.
 */
export function joinSheets(
  sheetA: SheetData,
  sheetB: SheetData,
  keyColA: string,
  keyColB: string,
  joinType: 'left' | 'inner' = 'left',
): SheetData {
  const idxA = sheetA.headers.indexOf(keyColA);
  const idxB = sheetB.headers.indexOf(keyColB);

  if (idxA < 0 || idxB < 0) return sheetA;

  // Build lookup index for Sheet B
  const bMap = new Map<string, string[]>();
  for (const rowB of sheetB.rows) {
    const key = String(rowB[idxB] ?? '').trim();
    if (key && !bMap.has(key)) {
      bMap.set(key, rowB);
    }
  }

  // Combine headers (avoid duplicate names by suffixing SheetB's name)
  const bHeadersWithoutKey = sheetB.headers.filter((_, i) => i !== idxB);
  const combinedHeaders = [
    ...sheetA.headers,
    ...bHeadersWithoutKey.map((h) =>
      sheetA.headers.includes(h) ? `${h}_(${sheetB.name})` : h,
    ),
  ];

  const emptyBRow = bHeadersWithoutKey.map(() => '');

  const combinedRows: string[][] = [];

  for (const rowA of sheetA.rows) {
    const key = String(rowA[idxA] ?? '').trim();
    const matchedB = bMap.get(key);

    if (matchedB) {
      const bValsWithoutKey = matchedB.filter((_, i) => i !== idxB);
      combinedRows.push([...rowA, ...bValsWithoutKey]);
    } else if (joinType === 'left') {
      combinedRows.push([...rowA, ...emptyBRow]);
    }
  }

  return {
    name: `${sheetA.name}_JOIN_${sheetB.name}`,
    headers: combinedHeaders,
    rows: combinedRows,
  };
}

/**
 * Vertically stack (Union) two sheets, aligning matching column headers.
 */
export function unionSheets(sheetA: SheetData, sheetB: SheetData): SheetData {
  // Combined unique headers in order
  const allHeaders = Array.from(new Set([...sheetA.headers, ...sheetB.headers]));

  const mapRowToHeaders = (sheet: SheetData, row: string[]) => {
    return allHeaders.map((header) => {
      const idx = sheet.headers.indexOf(header);
      return idx >= 0 && row[idx] !== undefined ? row[idx] : '';
    });
  };

  const rowsA = sheetA.rows.map((r) => mapRowToHeaders(sheetA, r));
  const rowsB = sheetB.rows.map((r) => mapRowToHeaders(sheetB, r));

  return {
    name: `${sheetA.name}_拼接_${sheetB.name}`,
    headers: allHeaders,
    rows: [...rowsA, ...rowsB],
  };
}
