import { isDateCell, isErrorCell, type GridCell } from './types';

/**
 * Render a binary floating point value the way a spreadsheet shows it: 15 significant
 * digits (Excel's precision) so that 0.1 + 0.2 becomes "0.3", and never exponent notation
 * for ordinary magnitudes.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  const rounded = Number(value.toPrecision(15));
  const text = String(rounded);
  if (!text.includes('e')) return text;
  if (Math.abs(rounded) >= 1e21) return text;
  return rounded.toFixed(20).replace(/\.?0+$/, '');
}

export function cellToText(cell: GridCell): string {
  if (cell === null) return '';
  if (typeof cell === 'string') return cell.trimEnd();
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
