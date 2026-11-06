import type { SheetData } from '../types';
import { looksDate, looksNumeric } from './import/cellText';

/**
 * Data health check: a read-only scan of one sheet. It never changes a value; every
 * finding names the rows (0-based data row index) and column it is about so the user
 * can look at them. See docs/health-check.md for the rules.
 */
export type HealthKind =
  | 'duplicateRow'
  | 'duplicateKey'
  | 'missing'
  | 'whitespace'
  | 'numberAsText'
  | 'nonNumeric'
  | 'formulaError'
  | 'outlier'
  | 'mixedDateFormat'
  | 'variantSpelling'
  | 'typedInFormulaColumn';

export interface HealthIssue {
  kind: HealthKind;
  severity: 'error' | 'warning' | 'info';
  /** Column index, absent for whole-row findings. */
  column?: number;
  title: string;
  detail: string;
  /** Affected data rows, ascending, without duplicates. */
  rows: number[];
}

export interface HealthReport {
  rowCount: number;
  columnCount: number;
  issues: HealthIssue[];
}

const ERROR_VALUES = new Set(['#DIV/0!', '#N/A', '#NAME?', '#NULL!', '#NUM!', '#REF!', '#VALUE!', '#SPILL!', '#CALC!', '#GETTING_DATA']);

/** Header words that mark an identifier column ("订单号", "Order ID", "account_id"). */
const KEY_HEADER = /(^|[^a-z])(id|code|no|number|key|sku)([^a-z]|$)|编号|编码|单号|代码|工号|学号|身份证|手机号|账号/i;

/** Plain decimal text: what spreadsheets store for numbers and CSV/XML/JSON write ("1084263.60"). */
const PLAIN_NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

export function isIdentifierHeader(header: string): boolean {
  return KEY_HEADER.test(header);
}

function plainNumber(v: string): number | null {
  if (!PLAIN_NUMBER.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isError(v: string): boolean {
  return ERROR_VALUES.has(v.trim());
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Shape of a date text, so "2024-01-31" and "2024/1/31" count as different formats. */
function dateShape(v: string): string {
  return v.trim().replace(/\d+/g, (m) => String(m.length));
}

/** A cell reference in a formula: optional sheet, `$` flags, column letters, row number. */
const CELL_REF = /("(?:[^"]|"")*")|('(?:[^']|'')+'!|[A-Za-z_][\w.]*!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(])/g;

/**
 * A formula with its relative row references written as offsets from its own row, so a
 * formula filled down a column has one shape: "B5*C5" in row 5 and "B6*C6" in row 6 both
 * become "B{+0}*C{+0}". Absolute rows ("$D$2"), sheet names and text literals stay as written.
 */
export function formulaShape(formula: string, row: number): string {
  return formula.replace(CELL_REF, (_m, str: string | undefined, sheet: string | undefined, colAbs: string, col: string, rowAbs: string, ref: string) => {
    if (str) return str;
    const head = `${sheet ?? ''}${colAbs}${col}`;
    if (rowAbs) return `${head}$${ref}`;
    const offset = Number(ref) - row;
    return `${head}{${offset >= 0 ? '+' : ''}${offset}}`;
  });
}

/** Key used to spot the same value written differently: case, width, inner spacing. */
function spellingKey(v: string): string {
  return v.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function pushRows(map: Map<string, number[]>, key: string, row: number): void {
  const list = map.get(key);
  if (list) list.push(row);
  else map.set(key, [row]);
}

/** Share of a column's non-empty, non-error values that read as numbers (plain or formatted). */
function numberShare(values: string[], skip: Set<number>): number {
  let filled = 0;
  let numeric = 0;
  values.forEach((v, r) => {
    if (v === '' || skip.has(r) || isError(v)) return;
    filled += 1;
    if (plainNumber(v) !== null || looksNumeric(v)) numeric += 1;
  });
  return filled === 0 ? 0 : numeric / filled;
}

/**
 * Rows that label a report rather than hold data: section headings ("Unit volume
 * (units)" with nothing else filled) and header-like rows ("Period ID | 2024-01 | ...")
 * in sheets whose columns are mostly numbers. Only recognised when the sheet has at
 * least three such columns, so ordinary tables are never affected.
 */
function labelRows(sheet: SheetData): Set<number> {
  const width = sheet.headers.length;
  const candidates = Array.from({ length: width }, (_, c) => c).filter(
    (c) => c > 0 && numberShare(sheet.rows.map((r) => r[c] ?? ''), new Set()) >= 0.6,
  );
  const out = new Set<number>();
  if (candidates.length < 3) return out;
  sheet.rows.forEach((row, r) => {
    const nonNumber = candidates.filter((c) => {
      const v = row[c] ?? '';
      return v === '' || (plainNumber(v) === null && !looksNumeric(v) && !isError(v));
    }).length;
    if (nonNumber / candidates.length >= 0.8) out.add(r);
  });
  return out;
}

export function checkSheetHealth(sheet: SheetData): HealthReport {
  const issues: HealthIssue[] = [];
  const width = sheet.headers.length;
  const height = sheet.rows.length;
  const name = (c: number) => `「${sheet.headers[c]}」`;
  const labels = labelRows(sheet);

  // Whole-row duplicates (all columns equal, blank rows excluded).
  const byRow = new Map<string, number[]>();
  sheet.rows.forEach((row, r) => {
    if (row.every((v) => (v ?? '') === '')) return;
    pushRows(byRow, JSON.stringify(sheet.headers.map((_, c) => row[c] ?? '')), r);
  });
  const dupGroups = [...byRow.values()].filter((g) => g.length > 1);
  const inDupGroup = new Set(dupGroups.flat());
  if (dupGroups.length) {
    const extra = dupGroups.flatMap((g) => g.slice(1)).sort((a, b) => a - b);
    issues.push({
      kind: 'duplicateRow',
      severity: 'warning',
      title: `${extra.length} 行与前面的行完全相同`,
      detail: `共 ${dupGroups.length} 组重复，列出的是每组中第一行之后的重复行。可在「数据处理 → 清洗 → 执行去重」中删除。`,
      rows: extra,
    });
  }

  for (let c = 0; c < width; c++) {
    const values = sheet.rows.map((row) => row[c] ?? '');
    const filled = values.filter((v) => v !== '').length;
    if (filled === 0) continue;

    const errRows = values.flatMap((v, r) => (isError(v) ? [r] : []));
    if (errRows.length) {
      issues.push({
        kind: 'formulaError',
        severity: 'error',
        column: c,
        title: `${name(c)}有 ${errRows.length} 个公式错误`,
        detail: `如 ${values[errRows[0]]}。这些单元格没有数值，求和、平均等计算会跳过它们。`,
        rows: errRows,
      });
    }

    // Missing values in a mostly filled column; blank rows and report labels are not data.
    const dataRows = values.flatMap((_, r) => (labels.has(r) || sheet.rows[r].every((x) => x === '') ? [] : [r]));
    const missing = dataRows.filter((r) => values[r] === '');
    if (missing.length && (dataRows.length - missing.length) / dataRows.length >= 0.5) {
      issues.push({
        kind: 'missing',
        severity: 'info',
        column: c,
        title: `${name(c)}有 ${missing.length} 个空值`,
        detail: `该列其余 ${dataRows.length - missing.length} 行都有值。`,
        rows: missing,
      });
    }

    const wsRows = values.flatMap((v, r) => (v !== '' && v !== v.trim() ? [r] : []));
    if (wsRows.length) {
      issues.push({
        kind: 'whitespace',
        severity: 'warning',
        column: c,
        title: `${name(c)}有 ${wsRows.length} 个值首尾带空格`,
        detail: `如 ${JSON.stringify(values[wsRows[0]])}。匹配、去重和关联时它与不带空格的值不相等。`,
        rows: wsRows,
      });
    }

    // Identifier columns: header says so, or nearly every value is distinct. Duplicates
    // only matter where values are meant to be unique (>= 90% distinct), so foreign keys
    // such as entity_id in a business-unit list are not reported.
    const distinct = new Map<string, number[]>();
    values.forEach((v, r) => v !== '' && pushRows(distinct, v, r));
    const uniqueShare = distinct.size / filled;
    // Mostly-distinct numbers are amounts, not ids; only a header makes a number column a key.
    const numeric = numberShare(values, labels) >= 0.9;
    const isKey =
      filled >= 2 &&
      uniqueShare >= 0.9 &&
      (isIdentifierHeader(sheet.headers[c]) || (!numeric && filled >= 20 && uniqueShare >= 0.98));
    if (isKey) {
      const keyDups = [...distinct.values()]
        .filter((g) => g.length > 1)
        .flat()
        .filter((r) => !inDupGroup.has(r))
        .sort((a, b) => a - b);
      if (keyDups.length > 1) {
        issues.push({
          kind: 'duplicateKey',
          severity: 'error',
          column: c,
          title: `${name(c)}应唯一，但有 ${keyDups.length} 行重复`,
          detail: `如 ${JSON.stringify(values[keyDups[0]])} 出现 ${distinct.get(values[keyDups[0]])?.length} 次。按它关联时会匹配到多行。`,
          rows: keyDups,
        });
      }
    }

    if (numberShare(values, labels) >= 0.9) {
      const dataValue = (r: number) => !labels.has(r) && values[r] !== '' && !isError(values[r]);
      // Numbers written with separators, currency or spaces ("1,200", "¥30", "12 "):
      // spreadsheets keep them as text and leave them out of sums.
      const textNum = values.flatMap((v, r) => (dataValue(r) && plainNumber(v) === null && looksNumeric(v) ? [r] : []));
      if (textNum.length) {
        issues.push({
          kind: 'numberAsText',
          severity: 'warning',
          column: c,
          title: `${name(c)}有 ${textNum.length} 个数字带了千分位、货币符号或空格`,
          detail: `如 ${JSON.stringify(values[textNum[0]])}。Excel 会把它当文本，求和时被忽略。`,
          rows: textNum,
        });
      }
      const nonNum = values.flatMap((v, r) => (dataValue(r) && plainNumber(v) === null && !looksNumeric(v) ? [r] : []));
      if (nonNum.length) {
        issues.push({
          kind: 'nonNumeric',
          severity: 'warning',
          column: c,
          title: `${name(c)}是数字列，但有 ${nonNum.length} 个非数字值`,
          detail: `如 ${JSON.stringify(values[nonNum[0]])}。`,
          rows: nonNum,
        });
      }

      // Magnitude outliers: more than 10x the 99th percentile of absolute values, the
      // signature of an extra zero or a wrong unit. Real amounts are skewed, so spread
      // rules (IQR) flag ordinary large debits; this only fires on an order-of-magnitude
      // jump. Identifier columns are skipped: an unusual code is not an unusual amount.
      const nums = values.map((v, r) => (labels.has(r) ? null : plainNumber(v)));
      const abs = nums.filter((n): n is number => n !== null).map(Math.abs).sort((a, b) => a - b);
      if (abs.length >= 20 && !isIdentifierHeader(sheet.headers[c])) {
        const p99 = quantile(abs, 0.99);
        if (p99 > 0) {
          const out = nums.flatMap((n, r) => (n !== null && Math.abs(n) > p99 * 10 ? [r] : []));
          if (out.length && out.length <= Math.max(1, abs.length * 0.01)) {
            issues.push({
              kind: 'outlier',
              severity: 'info',
              column: c,
              title: `${name(c)}有 ${out.length} 个值大了一个数量级以上`,
              detail: `超过该列 99% 的值的 10 倍（${p99.toPrecision(6)} 的 10 倍），如 ${values[out[0]]}。请确认是否多输了 0 或单位不对。`,
              rows: out,
            });
          }
        }
      }
      continue;
    }

    // Dates written in more than one format.
    const dated = values.flatMap((v, r) => (v !== '' && looksDate(v) ? [r] : []));
    if (dated.length >= 3 && dated.length / filled >= 0.8) {
      const shapes = new Map<string, number[]>();
      for (const r of dated) pushRows(shapes, dateShape(values[r]), r);
      if (shapes.size > 1) {
        const ranked = [...shapes.entries()].sort((a, b) => b[1].length - a[1].length);
        const minority = ranked.slice(1).flatMap(([, rows]) => rows).sort((a, b) => a - b);
        issues.push({
          kind: 'mixedDateFormat',
          severity: 'warning',
          column: c,
          title: `${name(c)}的日期有 ${shapes.size} 种写法`,
          detail: `多数是 ${JSON.stringify(values[ranked[0][1][0]])} 这种，${minority.length} 行写成别的样子（如 ${JSON.stringify(values[minority[0]])}）。排序和按月汇总会出错。`,
          rows: minority,
        });
      }
    }

    // Same category written differently (case, full-width, inner spaces), only for
    // category-like columns with few distinct values compared with rows.
    if (!isKey && distinct.size <= Math.max(50, filled * 0.5)) {
      const variants = new Map<string, Set<string>>();
      for (const v of distinct.keys()) {
        const k = spellingKey(v.trim());
        if (!variants.has(k)) variants.set(k, new Set());
        variants.get(k)?.add(v.trim());
      }
      const mixed = [...variants.values()].filter((s) => s.size > 1);
      if (mixed.length) {
        const rows: number[] = [];
        for (const set of mixed) {
          const counts = [...set].map((form) => ({ form, n: values.filter((v) => v.trim() === form).length }));
          counts.sort((a, b) => b.n - a.n);
          const minor = new Set(counts.slice(1).map((x) => x.form));
          values.forEach((v, r) => minor.has(v.trim()) && rows.push(r));
        }
        rows.sort((a, b) => a - b);
        issues.push({
          kind: 'variantSpelling',
          severity: 'warning',
          column: c,
          title: `${name(c)}有 ${mixed.length} 个值写法不统一`,
          detail: `如 ${[...mixed[0]].map((x) => JSON.stringify(x)).join(' 与 ')}，汇总和透视会把它们分成不同的组。`,
          rows,
        });
      }
    }
  }

  // A formula column where some rows hold a typed value instead (a number keyed over the
  // formula, so it no longer follows the source data). Excel marks these only with a
  // small green triangle. Only flagged when most of the column is one filled-down formula.
  const formulas = sheet.formulas;
  if (formulas) {
    for (let c = 0; c < width; c++) {
      const shapes = new Map<string, { n: number; example: string }>();
      const typed: number[] = [];
      let counted = 0;
      sheet.rows.forEach((row, r) => {
        if (labels.has(r) || (row[c] ?? '') === '') return;
        counted += 1;
        const f = formulas[r]?.[c] ?? null;
        if (f === null) {
          typed.push(r);
          return;
        }
        // Data rows are consecutive sheet rows, so the data row index works as the row.
        const shape = formulaShape(f, r);
        const entry = shapes.get(shape);
        if (entry) entry.n += 1;
        else shapes.set(shape, { n: 1, example: f });
      });
      const top = [...shapes.values()].sort((a, b) => b.n - a.n)[0];
      if (!top || typed.length === 0 || counted < 4 || top.n / counted < 0.6) continue;
      issues.push({
        kind: 'typedInFormulaColumn',
        severity: 'warning',
        column: c,
        title: `${name(c)}有 ${typed.length} 行是手填的值，其余 ${top.n} 行是公式`,
        detail: `公式如 =${top.example}。手填的数不会随源数据更新，请确认是不是有意覆盖。`,
        rows: typed,
      });
    }
  }

  const order = { error: 0, warning: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.severity] - order[b.severity] || (a.column ?? -1) - (b.column ?? -1));
  return { rowCount: height, columnCount: width, issues };
}
