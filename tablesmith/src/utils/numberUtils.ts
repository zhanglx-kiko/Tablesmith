/**
 * A cell is a number only when the whole cell is one, as Excel decides when it opens a
 * CSV: optional sign, optional currency symbol, digits (thousands separators only in
 * groups of three), optional decimals and exponent, optional trailing %. Accounting
 * negatives "(1,500)" count. "12%" is 0.12. Dates, codes and text such as "2024-01-31",
 * "12abc" or "1.2.3" are not numbers.
 */
const NUMBER_RE =
  /^([+-])?\s*[$¥￥€£₩฿]?\s*([+-])?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?\s*(%)?$/;

const EXCEL_MAX = 9.99999999999999e307;

/** Excel's error values, which formulas pass through unchanged. */
export const EXCEL_ERRORS: ReadonlySet<string> = new Set([
  '#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#GETTING_DATA', '#SPILL!', '#CALC!', '#FIELD!', '#BLOCKED!', '#CONNECT!', '#BUSY!', '#UNKNOWN!',
]);

export function parseNumericCell(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : NaN;
  if (val === null || val === undefined) return NaN;
  let str = String(val).trim();
  if (!str) return NaN;

  let negative = false;
  const paren = /^\((.*)\)$/.exec(str);
  if (paren) {
    negative = true;
    str = paren[1].trim();
  }
  const m = NUMBER_RE.exec(str);
  if (!m) return NaN;
  const [, sign1, sign2, digits, exp, percent] = m;
  // One sign at most, and none inside accounting parentheses.
  if (sign1 && sign2) return NaN;
  const sign = sign1 ?? sign2;
  if (paren && sign) return NaN;
  if (sign === '-') negative = !negative;

  let num = Number(digits.replace(/,/g, '') + (exp !== undefined ? `e${exp}` : ''));
  // Excel's largest number is 9.99999999999999E+307; it keeps anything bigger as text.
  if (!Number.isFinite(num) || num > EXCEL_MAX) return NaN;
  if (percent) num /= 100;
  return negative ? -num : num;
}

/**
 * Epoch milliseconds for date text the import produces ("2024-01-31", "2024-01-31
 * 13:45:41") and common typed forms ("2024/1/31"). NaN for anything else, including
 * impossible dates such as 2024-02-30.
 */
export function parseDateCell(val: unknown): number {
  if (val === null || val === undefined) return NaN;
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?$/.exec(String(val).trim());
  if (!m) return NaN;
  const [y, mo, d, h = '0', mi = '0', s = '0', frac = ''] = m.slice(1);
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, frac ? Math.round(Number(`0.${frac}`) * 1000) : 0);
  const check = new Date(ms);
  if (check.getUTCMonth() !== +mo - 1 || check.getUTCDate() !== +d || +h > 23 || +mi > 59 || +s > 59) return NaN;
  return ms;
}

/**
 * Compare two cell values numerically if both are valid numbers,
 * otherwise fall back to locale string comparison.
 */
export function compareCellsNumeric(a: unknown, b: unknown): number {
  const numA = parseNumericCell(a);
  const numB = parseNumericCell(b);

  const aIsNum = !isNaN(numA);
  const bIsNum = !isNaN(numB);

  if (aIsNum && bIsNum) {
    return numA - numB;
  }
  if (aIsNum) return -1;
  if (bIsNum) return 1;

  const strA = a === null || a === undefined ? '' : String(a);
  const strB = b === null || b === undefined ? '' : String(b);
  return strA.localeCompare(strB, 'zh-CN');
}
