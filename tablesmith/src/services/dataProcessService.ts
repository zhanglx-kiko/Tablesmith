import type { SheetData } from '../types';
import { EXCEL_ERRORS, parseDateCell, parseNumericCell } from '../utils/numberUtils';
import { formatNumber } from './import/cellText';

/**
 * Per-cell layers that travel with their cell: Excel's display text and the formula
 * behind the value. Both are the same shape as `rows`, null where a cell has none.
 */
const LAYERS = ['display', 'formulas'] as const;
type Layer = (typeof LAYERS)[number];

/** A layer's cells for one row, padded to the header count. */
function layerRow(sheet: SheetData, layer: Layer, r: number): (string | null)[] {
  return sheet.headers.map((_, c) => sheet[layer]?.[r]?.[c] ?? null);
}

/**
 * Keep only the given rows, carrying the cell layers along so they stay aligned with
 * `rows`. Every operation that drops or reorders rows must go through this.
 */
export function selectRows(sheet: SheetData, indices: number[]): SheetData {
  const out: SheetData = { name: sheet.name, headers: sheet.headers, rows: indices.map((i) => sheet.rows[i]) };
  for (const layer of LAYERS) if (sheet[layer]) out[layer] = indices.map((i) => sheet[layer]?.[i] ?? []);
  return out;
}

/**
 * Replace raw values. Any cell whose raw value changes loses its display text and its
 * formula, since both described the old value (masked or trimmed data must never show
 * through, and a changed value no longer comes from the formula).
 */
export function withRows(sheet: SheetData, rows: string[][]): SheetData {
  const out: SheetData = { name: sheet.name, headers: sheet.headers, rows };
  for (const layer of LAYERS) {
    if (!sheet[layer]) continue;
    out[layer] = rows.map((row, r) => row.map((v, c) => (v === sheet.rows[r]?.[c] ? (sheet[layer]?.[r]?.[c] ?? null) : null)));
  }
  return out;
}

/** Keep the given columns (by index, in order), for headers, rows and cell layers alike. */
export function selectColumns(sheet: SheetData, keep: number[]): SheetData {
  const out: SheetData = {
    name: sheet.name,
    headers: keep.map((i) => sheet.headers[i]),
    rows: sheet.rows.map((row) => keep.map((i) => row[i] ?? '')),
  };
  for (const layer of LAYERS) {
    const cells = sheet[layer];
    if (cells) out[layer] = sheet.rows.map((_, r) => keep.map((i) => cells[r]?.[i] ?? null));
  }
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

/** A plain number as Excel reads it from a CSV: sign, digits, exponent, "(5)" as -5. */
const PLAIN_NUMBER_RE = /^(\()?([+-])?\s*(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?(\))?$/;

/**
 * Cell text as Excel's Remove Duplicates compares it, which is the value Excel displays:
 * plain numbers by value ("1" = "1.0" = "+1", "(5)" = "-5"), dates by date ("2024/1/31" =
 * "2024-01-31"), other text ignoring case ("ABC" = "abc"). Numbers Excel shows with their
 * own format stay apart ("1,000" vs "1000", "10%" vs "0.1"), as they do in Excel.
 */
function dedupeKey(v: string): string {
  const text = v ?? '';
  const m = PLAIN_NUMBER_RE.exec(text);
  if (m && Boolean(m[1]) === Boolean(m[5]) && !(m[1] && m[2])) {
    const n = Number(`${m[3]}${m[4] ?? ''}`);
    // Excel shows "1e0" in scientific format, so it is not a duplicate of "1".
    if (Number.isFinite(n)) return `${m[4] ? 'E' : '#'}${m[1] || m[2] === '-' ? -n : n}`;
  }
  const d = parseDateCell(text);
  if (!Number.isNaN(d)) return `@${d}`;
  return `"${text.toLowerCase()}`;
}

/**
 * Remove duplicate rows like Excel's Remove Duplicates, keeping the first occurrence.
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
    const key = JSON.stringify(colIndices.map((i) => dedupeKey(row[i] ?? '')));
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

  /**
   * Compare as numbers when both sides are numbers, else as dates when both are dates
   * ("2024-06-30"). Anything else never matches a comparison.
   */
  const compare = (cell: string, target: string): number | null => {
    const a = parseNumericCell(cell);
    const b = parseNumericCell(target);
    if (!Number.isNaN(a) && !Number.isNaN(b)) return a - b;
    const da = parseDateCell(cell);
    const db = parseDateCell(target);
    if (!Number.isNaN(da) && !Number.isNaN(db)) return da - db;
    return null;
  };

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
          const d = compare(cellVal, targetVal);
          return d !== null && d > 0;
        }
        case 'lessThan': {
          const d = compare(cellVal, targetVal);
          return d !== null && d < 0;
        }
        case 'greaterThanOrEqual': {
          const d = compare(cellVal, targetVal);
          return d !== null && d >= 0;
        }
        case 'lessThanOrEqual': {
          const d = compare(cellVal, targetVal);
          return d !== null && d <= 0;
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
 * An operand of an Excel formula: an empty cell is 0, TRUE / FALSE are 1 / 0, numbers
 * (also "1,000", "$30", "(5)", "10%") are their value, an error value passes through,
 * anything else (including a cell holding only spaces) is text, which is #VALUE!.
 */
function operand(v: string): number | string {
  if (v === '') return 0;
  const t = v.trim();
  if (EXCEL_ERRORS.has(t.toUpperCase())) return t.toUpperCase();
  const upper = t.toUpperCase();
  if (upper === 'TRUE') return 1;
  if (upper === 'FALSE') return 0;
  const n = parseNumericCell(t);
  return Number.isNaN(n) ? '#VALUE!' : n;
}

/**
 * One arithmetic cell exactly like the Excel formula =A+B (=A-B, =A*B, =A/B): see
 * `operand`; the first error wins, division by zero gives #DIV/0!. The result keeps full
 * double precision; one beyond Excel's range is #NUM!.
 */
function calc(a: string, b: string, op: ComputedColumnConfig['operator']): string {
  const x = operand(a);
  if (typeof x === 'string') return x;
  const y = operand(b);
  if (typeof y === 'string') return y;
  const r = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : op === '/' ? (y === 0 ? NaN : x / y) : null;
  if (r === null) return '';
  if (Number.isNaN(r)) return '#DIV/0!';
  if (!Number.isFinite(r) || Math.abs(r) > 9.99999999999999e307) return '#NUM!';
  // Excel has no negative zero.
  return formatNumber(r === 0 ? 0 : r);
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
      computedVal = calc(valA, valB, config.operator);
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
  for (const layer of LAYERS) if (sheet[layer]) out[layer] = sheet.rows.map((_, r) => [...layerRow(sheet, layer, r), null]);
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

  // Key -> index of the first matching row in sheetB.
  const bMap = new Map<string, number>();
  const counts = new Map<string, { key: string; count: number }>();
  sheetB.rows.forEach((rowB, bRow) => {
    const raw = String(rowB[idxB] ?? '');
    const key = joinKey(raw);
    if (!key) return;
    if (!bMap.has(key)) bMap.set(key, bRow);
    const c = counts.get(key);
    if (c) c.count += 1;
    else counts.set(key, { key: raw.trim(), count: 1 });
  });

  // Combine headers (avoid duplicate names by suffixing SheetB's name)
  const bHeadersWithoutKey = sheetB.headers.filter((_, i) => i !== idxB);
  const combinedHeaders = [
    ...sheetA.headers,
    ...bHeadersWithoutKey.map((h) => (sheetA.headers.includes(h) ? `${h}_(${sheetB.name})` : h)),
  ];
  const emptyBRow = bHeadersWithoutKey.map(() => '');
  const combinedRows: string[][] = [];
  // Display text and formulas travel with their cell, from either table.
  const layers = LAYERS.filter((l) => sheetA[l] || sheetB[l]);
  const combined: Partial<Record<Layer, (string | null)[][]>> = {};
  for (const l of layers) combined[l] = [];
  const emptyB = bHeadersWithoutKey.map(() => null);
  let matched = 0;
  sheetA.rows.forEach((rowA, r) => {
    const bRow = bMap.get(joinKey(String(rowA[idxA] ?? '')));
    if (bRow !== undefined) {
      matched += 1;
      combinedRows.push([...rowA, ...sheetB.rows[bRow].filter((_, i) => i !== idxB)]);
      for (const l of layers) combined[l]?.push([...layerRow(sheetA, l, r), ...layerRow(sheetB, l, bRow).filter((_, i) => i !== idxB)]);
    } else if (joinType === 'left') {
      combinedRows.push([...rowA, ...emptyBRow]);
      for (const l of layers) combined[l]?.push([...layerRow(sheetA, l, r), ...emptyB]);
    }
  });

  return {
    result: { name: `${sheetA.name}_JOIN_${sheetB.name}`, headers: combinedHeaders, rows: combinedRows, ...combined },
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
  const place = <T>(sheet: SheetData, row: T[] | undefined, empty: T): T[] =>
    allHeaders.map((header) => {
      const idx = sheet.headers.indexOf(header);
      const v = idx >= 0 ? row?.[idx] : undefined;
      return v === undefined ? empty : v;
    });

  const out: SheetData = {
    name: `${sheetA.name}_拼接_${sheetB.name}`,
    headers: allHeaders,
    rows: [...sheetA.rows.map((r) => place(sheetA, r, '')), ...sheetB.rows.map((r) => place(sheetB, r, ''))],
  };
  // Display text and formulas travel with their cell, from either table.
  for (const l of LAYERS) {
    if (!sheetA[l] && !sheetB[l]) continue;
    out[l] = [
      ...sheetA.rows.map((_, r) => place<string | null>(sheetA, sheetA[l]?.[r], null)),
      ...sheetB.rows.map((_, r) => place<string | null>(sheetB, sheetB[l]?.[r], null)),
    ];
  }
  return out;
}
