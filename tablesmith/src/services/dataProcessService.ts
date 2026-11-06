import type { SheetData } from '../types';
import { parseNumericCell } from '../utils/numberUtils';

/**
 * Keep only the given rows, carrying `display` along so it stays aligned with `rows`.
 * Every operation that drops or reorders rows must go through this.
 */
export function selectRows(sheet: SheetData, indices: number[]): SheetData {
  const out: SheetData = { name: sheet.name, headers: sheet.headers, rows: indices.map((i) => sheet.rows[i]) };
  if (sheet.display) out.display = indices.map((i) => sheet.display?.[i] ?? []);
  return out;
}

/**
 * Replace raw values. Any cell whose raw value changes loses its display text, since the
 * Excel rendering described the old value (masked or trimmed data must never show through).
 */
export function withRows(sheet: SheetData, rows: string[][]): SheetData {
  const out: SheetData = { name: sheet.name, headers: sheet.headers, rows };
  if (sheet.display) {
    out.display = rows.map((row, r) =>
      row.map((v, c) => (v === sheet.rows[r]?.[c] ? (sheet.display?.[r]?.[c] ?? null) : null)),
    );
  }
  return out;
}

/** Keep the given columns (by index, in order), for headers, rows and display alike. */
export function selectColumns(sheet: SheetData, keep: number[]): SheetData {
  const out: SheetData = {
    name: sheet.name,
    headers: keep.map((i) => sheet.headers[i]),
    rows: sheet.rows.map((row) => keep.map((i) => row[i] ?? '')),
  };
  if (sheet.display) out.display = sheet.display.map((row) => keep.map((i) => row[i] ?? null));
  return out;
}

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
  const kept: number[] = [];

  sheet.rows.forEach((row, r) => {
    // JSON keeps cells distinct even when they contain any separator text.
    const key = JSON.stringify(colIndices.map((i) => row[i] ?? ''));
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(r);
    }
  });

  return {
    result: selectRows(sheet, kept),
    removedCount: sheet.rows.length - kept.length,
  };
}

/**
 * Remove rows where every cell is empty or only whitespace.
 */
export function removeEmptyRows(sheet: SheetData): { result: SheetData; removedCount: number } {
  const kept: number[] = [];
  sheet.rows.forEach((row, r) => {
    if (row.some((cell) => cell !== null && cell !== undefined && cell.trim() !== '')) kept.push(r);
  });
  return {
    result: selectRows(sheet, kept),
    removedCount: sheet.rows.length - kept.length,
  };
}

/**
 * Trim leading and trailing whitespace from every cell.
 */
export function trimWhitespace(sheet: SheetData): SheetData {
  const newRows = sheet.rows.map((row) =>
    row.map((cell) => (typeof cell === 'string' ? cell.trim() : cell)),
  );
  return withRows(sheet, newRows);
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

  const kept: number[] = [];
  sheet.rows.forEach((row, r) => {
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

    const hit = matchType === 'all' ? conditions.every(testCondition) : conditions.some(testCondition);
    if (hit) kept.push(r);
  });

  return {
    result: selectRows(sheet, kept),
    matchCount: kept.length,
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

  const out: SheetData = { name: sheet.name, headers: newHeaders, rows: newRows };
  if (sheet.display) out.display = sheet.display.map((row) => [...row, null]);
  return out;
}

/**
 * Delete specified columns from a sheet.
 */
export function deleteColumns(sheet: SheetData, colsToDelete: string[]): SheetData {
  const deleteSet = new Set(colsToDelete);
  const keepIndices = sheet.headers.flatMap((h, i) => (deleteSet.has(h) ? [] : [i]));
  return selectColumns(sheet, keepIndices);
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

  // withRows clears the display of every masked cell, so the original never shows.
  return {
    result: withRows(sheet, newRows),
    maskedCount,
  };
}

// ---------------- 多表合并与关联 (Join & Union) ----------------

export interface JoinStats {
  /** Main-table rows that found a match. */
  matched: number;
  /** Main-table rows with no match (kept empty in a left join, dropped in an inner join). */
  unmatched: number;
  /** Keys that appear more than once in the second table, with how many times. */
  duplicateKeys: { key: string; count: number }[];
}

/**
 * Key text used for matching: trimmed, and plain numbers by value so "199" in one file
 * matches "199.00" in another. Other text must match exactly.
 */
export function joinKey(v: string): string {
  const t = (v ?? '').trim();
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return `#${n}`;
  }
  return t;
}

/**
 * Horizontally merge (JOIN) two sheets on a key column, like VLOOKUP: each main-table
 * row takes the first matching row of the second table. A key repeated in the second
 * table is reported in `stats.duplicateKeys` (the other matches are not used), never
 * dropped silently.
 */
export function joinSheets(
  sheetA: SheetData,
  sheetB: SheetData,
  keyColA: string,
  keyColB: string,
  joinType: 'left' | 'inner' = 'left',
): { result: SheetData; stats: JoinStats } {
  const idxA = sheetA.headers.indexOf(keyColA);
  const idxB = sheetB.headers.indexOf(keyColB);
  if (idxA < 0 || idxB < 0) {
    return { result: sheetA, stats: { matched: 0, unmatched: sheetA.rows.length, duplicateKeys: [] } };
  }

  const bMap = new Map<string, string[]>();
  const counts = new Map<string, { key: string; count: number }>();
  for (const rowB of sheetB.rows) {
    const raw = String(rowB[idxB] ?? '');
    const key = joinKey(raw);
    if (!key) continue;
    if (!bMap.has(key)) bMap.set(key, rowB);
    const c = counts.get(key);
    if (c) c.count += 1;
    else counts.set(key, { key: raw.trim(), count: 1 });
  }

  // Combine headers (avoid duplicate names by suffixing SheetB's name)
  const bHeadersWithoutKey = sheetB.headers.filter((_, i) => i !== idxB);
  const combinedHeaders = [
    ...sheetA.headers,
    ...bHeadersWithoutKey.map((h) => (sheetA.headers.includes(h) ? `${h}_(${sheetB.name})` : h)),
  ];
  const emptyBRow = bHeadersWithoutKey.map(() => '');
  const combinedRows: string[][] = [];
  let matched = 0;
  for (const rowA of sheetA.rows) {
    const matchedB = bMap.get(joinKey(String(rowA[idxA] ?? '')));
    if (matchedB) {
      matched += 1;
      combinedRows.push([...rowA, ...matchedB.filter((_, i) => i !== idxB)]);
    } else if (joinType === 'left') {
      combinedRows.push([...rowA, ...emptyBRow]);
    }
  }

  return {
    result: { name: `${sheetA.name}_JOIN_${sheetB.name}`, headers: combinedHeaders, rows: combinedRows },
    stats: {
      matched,
      unmatched: sheetA.rows.length - matched,
      duplicateKeys: [...counts.values()].filter((c) => c.count > 1),
    },
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
