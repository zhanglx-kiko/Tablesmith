/**
 * Robust numeric parser for arbitrary table cell values.
 * Handles financial formats, thousand separators, currency symbols,
 * accounting negative parentheses, and trailing percentage marks.
 */
export function parseNumericCell(val: unknown): number {
  if (typeof val === 'number') {
    return isFinite(val) ? val : NaN;
  }
  if (val === null || val === undefined) return NaN;
  let str = String(val).trim();
  if (!str) return NaN;

  let isNegative = false;

  // Handle accounting parentheses negative e.g. "(1,500)" or "($2,000.50)"
  if (/^\(.*\)$/.test(str)) {
    isNegative = true;
    str = str.slice(1, -1).trim();
  } else if (str.startsWith('-')) {
    isNegative = true;
    str = str.slice(1).trim();
  } else if (str.startsWith('+')) {
    str = str.slice(1).trim();
  }

  // Remove currency symbols: $, ¥, ￥, €, £, ₩, ฿
  str = str.replace(/[\$¥￥€£₩฿]/g, '').trim();

  // Remove thousand separator commas e.g. "1,234,567.89"
  str = str.replace(/,/g, '');

  // Strip trailing % for raw numeric operations e.g. "25.5%" -> 25.5
  if (str.endsWith('%')) {
    str = str.slice(0, -1).trim();
  }

  const num = parseFloat(str);
  if (isNaN(num)) return NaN;
  return isNegative ? -num : num;
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
