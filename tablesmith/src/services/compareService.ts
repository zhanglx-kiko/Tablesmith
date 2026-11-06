import type { SheetData } from '../types';
import { exactNumber } from './import/cellText';

/**
 * Cross-file compare: match rows of two tables by key columns and report rows only in
 * the old table, only in the new one, and changed cells. Pure and read-only. Nothing is
 * silently dropped: duplicate keys and empty keys are reported, never collapsed to the
 * first match. See docs/compare.md.
 */
export interface CompareOptions {
  /** Columns that identify a row, present in both tables. */
  keys: string[];
  /** Compare numbers by value ("199" equals "199.00"); text always compares exactly. Default true. */
  numericByValue?: boolean;
  /** Ignore leading / trailing spaces when comparing text and keys. Default false. */
  ignoreWhitespace?: boolean;
  /** Ignore letter case when comparing text and keys. Default false. */
  ignoreCase?: boolean;
}

export interface CellChange {
  column: string;
  before: string;
  after: string;
  /** after - before, when both are numbers. */
  delta?: number;
}

export interface ChangedRow {
  key: string[];
  /** 0-based data row in each table. */
  oldRow: number;
  newRow: number;
  changes: CellChange[];
}

export interface DuplicateKey {
  key: string[];
  side: 'old' | 'new';
  rows: number[];
}

export interface CompareResult {
  keys: string[];
  /** Compared columns: present in both tables, keys excluded, in old-table order. */
  columns: string[];
  onlyOldColumns: string[];
  onlyNewColumns: string[];
  removed: { key: string[]; row: number }[];
  added: { key: string[]; row: number }[];
  changed: ChangedRow[];
  unchanged: number;
  /** Rows whose key repeats inside one table; they are left out of matching. */
  duplicates: DuplicateKey[];
  /** Rows with every key cell empty; left out of matching. */
  emptyKey: { side: 'old' | 'new'; row: number }[];
}

export class CompareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompareError';
  }
}

function normalizer(opts: CompareOptions): (v: string) => string {
  return (v) => {
    let out = opts.ignoreWhitespace ? v.trim() : v;
    if (opts.ignoreCase) out = out.toLowerCase();
    return out;
  };
}

/** True when two cells hold the same value under the options. */
export function sameCell(a: string, b: string, opts: CompareOptions): boolean {
  const norm = normalizer(opts);
  if (norm(a) === norm(b)) return true;
  if (opts.numericByValue === false) return false;
  // Only plain stored numbers compare by value; "1,200" vs "1200" is a text difference.
  const na = exactNumberLoose(a.trim());
  const nb = exactNumberLoose(b.trim());
  return na !== null && nb !== null && na === nb;
}

/** A plain decimal number ("199", "199.00", "-0.5"); trailing zeros allowed. */
function exactNumberLoose(v: string): number | null {
  if (exactNumber(v) !== null) return exactNumber(v);
  if (!/^-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function index(sheet: SheetData, keyIdx: number[], norm: (v: string) => string) {
  const map = new Map<string, number[]>();
  const empty: number[] = [];
  sheet.rows.forEach((row, r) => {
    const parts = keyIdx.map((i) => norm(row[i] ?? ''));
    if (parts.every((p) => p === '')) {
      empty.push(r);
      return;
    }
    const k = JSON.stringify(parts);
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  });
  return { map, empty };
}

export function compareSheets(oldSheet: SheetData, newSheet: SheetData, opts: CompareOptions): CompareResult {
  if (opts.keys.length === 0) throw new CompareError('请至少选择一个用来匹配行的列（如订单号）');
  const missingOld = opts.keys.filter((k) => !oldSheet.headers.includes(k));
  const missingNew = opts.keys.filter((k) => !newSheet.headers.includes(k));
  if (missingOld.length || missingNew.length) {
    const parts = [];
    if (missingOld.length) parts.push(`旧表没有${missingOld.map((k) => `「${k}」`).join('、')}`);
    if (missingNew.length) parts.push(`新表没有${missingNew.map((k) => `「${k}」`).join('、')}`);
    throw new CompareError(`匹配列不在两张表中：${parts.join('，')}`);
  }
  const norm = normalizer(opts);
  const keyOld = opts.keys.map((k) => oldSheet.headers.indexOf(k));
  const keyNew = opts.keys.map((k) => newSheet.headers.indexOf(k));
  const columns = oldSheet.headers.filter((h) => !opts.keys.includes(h) && newSheet.headers.includes(h));
  const colPairs = columns.map((h) => [oldSheet.headers.indexOf(h), newSheet.headers.indexOf(h)] as const);

  const a = index(oldSheet, keyOld, norm);
  const b = index(newSheet, keyNew, norm);
  const result: CompareResult = {
    keys: opts.keys,
    columns,
    onlyOldColumns: oldSheet.headers.filter((h) => !newSheet.headers.includes(h)),
    onlyNewColumns: newSheet.headers.filter((h) => !oldSheet.headers.includes(h)),
    removed: [],
    added: [],
    changed: [],
    unchanged: 0,
    duplicates: [],
    emptyKey: [...a.empty.map((row) => ({ side: 'old' as const, row })), ...b.empty.map((row) => ({ side: 'new' as const, row }))],
  };
  const keyOf = (k: string) => JSON.parse(k) as string[];
  const dupKeys = new Set<string>();
  for (const [k, rows] of a.map) if (rows.length > 1) { result.duplicates.push({ key: keyOf(k), side: 'old', rows }); dupKeys.add(k); }
  for (const [k, rows] of b.map) if (rows.length > 1) { result.duplicates.push({ key: keyOf(k), side: 'new', rows }); dupKeys.add(k); }

  for (const [k, rowsOld] of a.map) {
    if (dupKeys.has(k)) continue;
    const rowsNew = b.map.get(k);
    const oldRow = rowsOld[0];
    if (!rowsNew) {
      result.removed.push({ key: keyOf(k), row: oldRow });
      continue;
    }
    const newRow = rowsNew[0];
    const changes: CellChange[] = [];
    for (const [ci, cj] of colPairs) {
      const before = oldSheet.rows[oldRow][ci] ?? '';
      const after = newSheet.rows[newRow][cj] ?? '';
      if (sameCell(before, after, opts)) continue;
      const nb = exactNumberLoose(before.trim());
      const na = exactNumberLoose(after.trim());
      changes.push({ column: oldSheet.headers[ci], before, after, ...(nb !== null && na !== null ? { delta: na - nb } : {}) });
    }
    if (changes.length) result.changed.push({ key: keyOf(k), oldRow, newRow, changes });
    else result.unchanged += 1;
  }
  for (const [k, rowsNew] of b.map) {
    if (dupKeys.has(k) || a.map.has(k)) continue;
    result.added.push({ key: keyOf(k), row: rowsNew[0] });
  }
  result.removed.sort((x, y) => x.row - y.row);
  result.added.sort((x, y) => x.row - y.row);
  result.changed.sort((x, y) => x.newRow - y.newRow);
  return result;
}

/**
 * The comparison as one table, for viewing, filtering and export: one row per key with
 * 状态 (新增 / 删除 / 修改 / 重复键), then each compared column's old and new value.
 * Unchanged rows are left out.
 */
export function compareToSheet(result: CompareResult, oldSheet: SheetData, newSheet: SheetData, name = '对比结果'): SheetData {
  const headers = ['状态', ...result.keys, '变化列', ...result.columns.flatMap((c) => [`${c}（旧）`, `${c}（新）`])];
  const cols = (sheet: SheetData, row: number) => result.columns.map((c) => sheet.rows[row]?.[sheet.headers.indexOf(c)] ?? '');
  const rows: string[][] = [];
  for (const c of result.changed) {
    const before = cols(oldSheet, c.oldRow);
    const after = cols(newSheet, c.newRow);
    rows.push(['修改', ...c.key, c.changes.map((x) => x.column).join('、'), ...before.flatMap((v, i) => [v, after[i]])]);
  }
  for (const r of result.added) rows.push(['新增', ...r.key, '', ...cols(newSheet, r.row).flatMap((v) => ['', v])]);
  for (const r of result.removed) rows.push(['删除', ...r.key, '', ...cols(oldSheet, r.row).flatMap((v) => [v, ''])]);
  for (const d of result.duplicates) {
    const sheet = d.side === 'old' ? oldSheet : newSheet;
    for (const row of d.rows) {
      const vals = cols(sheet, row);
      rows.push([d.side === 'old' ? '重复键（旧表）' : '重复键（新表）', ...d.key, '', ...vals.flatMap((v) => (d.side === 'old' ? [v, ''] : ['', v]))]);
    }
  }
  return { name, headers, rows };
}
