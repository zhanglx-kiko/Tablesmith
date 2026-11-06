import { isDateCell, isErrorCell, type GridCell } from './types';

/**
 * Raw text of a stored number: the shortest decimal that reads back as exactly the same
 * double (what Excel holds), so importing never changes a value. Plain decimal notation
 * for ordinary magnitudes. Excel's 15-digit rendering (0.30000000000000004 shows as 0.3)
 * belongs to the display layer, not here.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  const text = String(value);
  if (!text.includes('e')) return text;
  if (Math.abs(value) >= 1e21) return text;
  // 1e-7 -> "0.0000001": expand the exponent without adding or dropping digits.
  const [mantissa, exp] = text.split('e');
  const e = Number(exp);
  const negative = mantissa.startsWith('-');
  const digits = mantissa.replace('-', '').replace('.', '');
  const point = mantissa.replace('-', '').indexOf('.');
  const intLen = (point === -1 ? digits.length : point) + e;
  const body =
    intLen <= 0
      ? `0.${'0'.repeat(-intLen)}${digits}`
      : intLen >= digits.length
        ? digits + '0'.repeat(intLen - digits.length)
        : `${digits.slice(0, intLen)}.${digits.slice(intLen)}`;
  return negative ? `-${body}` : body;
}

/**
 * The number a cell's text exactly is, or null. Only text that reads back as the very
 * same number qualifies, so exports never alter a value: "00892", "61.4%", "$1,200" and
 * 16-digit ids such as "2026110488921001" (beyond Excel's 15 digits) stay text.
 */
export function exactNumber(v: string): number | null {
  if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(v)) return null;
  const n = Number(v);
  // Same writer as the importer, so whatever import produced is accepted exactly.
  if (!Number.isFinite(n) || formatNumber(n) !== v) return null;
  // Integers longer than Excel's 15 digits are identifiers, not quantities. Decimals keep
  // their full stored precision (45351.57326388889 came from a number cell).
  const isInteger = !/[.e]/i.test(v);
  return isInteger && v.replace(/^-/, '').length > 15 ? null : n;
}

export function cellToText(cell: GridCell): string {
  if (cell === null) return '';
  if (typeof cell === 'string') return cell;
  if (typeof cell === 'number') return formatNumber(cell);
  if (typeof cell === 'boolean') return cell ? 'TRUE' : 'FALSE';
  if (isDateCell(cell)) return cell.date;
  if (isErrorCell(cell)) return cell.error;
  return '';
}

const NUMERIC_PATTERN =
  /^[+-]?\(?[+-]?[$¥￥€£]?\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][+-]?\d+)?\s?%?\)?$|^[+-]?\.\d+$/;

/** Strict numeric test (unlike parseFloat, "2024-01" or "12 apples" are not numbers). */
export function looksNumeric(text: string): boolean {
  const t = text.trim();
  return t !== '' && NUMERIC_PATTERN.test(t);
}

// Year-month needs "-", "/" or "年" ("2024-01", "2024年1月"); with "." a full date is required
// so that decimals such as "1234.5" are not read as dates.
const DATE_PATTERN =
  /^(?:(?:19|20)\d{2}(?:[-/]\d{1,2}(?:[-/]\d{1,2})?|年\d{1,2}月(?:\d{1,2}日)?|\.\d{1,2}\.\d{1,2})|\d{1,2}[-/.]\d{1,2}[-/.](?:19|20)?\d{2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$|^\d{1,2}:\d{2}(?::\d{2})?$/;

export function looksDate(text: string): boolean {
  const t = text.trim();
  return t !== '' && DATE_PATTERN.test(t);
}

export type CellKind = 'empty' | 'number' | 'date' | 'label';

export function cellKind(cell: GridCell): CellKind {
  if (cell === null) return 'empty';
  if (typeof cell === 'number') return 'number';
  if (typeof cell === 'boolean') return 'label';
  if (isDateCell(cell)) return 'date';
  if (isErrorCell(cell)) return 'number';
  const t = cell.trim();
  if (t === '') return 'empty';
  if (looksNumeric(t)) return 'number';
  if (looksDate(t)) return 'date';
  return 'label';
}
