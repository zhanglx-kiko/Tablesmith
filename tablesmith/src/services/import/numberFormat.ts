import * as XLSX from 'xlsx';

/**
 * Built-in number format ids as zh-CN desktop Excel resolves them (measured with
 * scripts/generate-builtin-formats.py + scripts/excel-reference.ps1). Several ids differ
 * from the ECMA-376 / en-US table SheetJS ships, e.g. 14 is yyyy/m/d and 37 is #,##0;-#,##0.
 */
export const BUILTIN_FORMATS_ZH_CN: Record<number, string> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
  5: '¥#,##0;¥-#,##0', 6: '¥#,##0;[Red]¥-#,##0', 7: '¥#,##0.00;¥-#,##0.00', 8: '¥#,##0.00;[Red]¥-#,##0.00',
  9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??',
  14: 'yyyy/m/d', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM',
  20: 'h:mm', 21: 'h:mm:ss', 22: 'yyyy/m/d h:mm',
  23: '$#,##0_);($#,##0)', 24: '$#,##0_);[Red]($#,##0)', 25: '$#,##0.00_);($#,##0.00)', 26: '$#,##0.00_);[Red]($#,##0.00)',
  27: 'yyyy"年"m"月"', 28: 'm"月"d"日"', 29: 'm"月"d"日"', 30: 'm/d/yy', 31: 'yyyy"年"m"月"d"日"',
  32: 'h"时"mm"分"', 33: 'h"时"mm"分"ss"秒"', 34: '上午/下午h"时"mm"分"', 35: '上午/下午h"时"mm"分"ss"秒"', 36: 'yyyy"年"m"月"',
  37: '#,##0;-#,##0', 38: '#,##0;[Red]-#,##0', 39: '#,##0.00;-#,##0.00', 40: '#,##0.00;[Red]-#,##0.00',
  41: '_ * #,##0_ ;_ * -#,##0_ ;_ * "-"_ ;_ @_ ', 42: '_ ¥* #,##0_ ;_ ¥* -#,##0_ ;_ ¥* "-"_ ;_ @_ ',
  43: '_ * #,##0.00_ ;_ * -#,##0.00_ ;_ * "-"??_ ;_ @_ ', 44: '_ ¥* #,##0.00_ ;_ ¥* -#,##0.00_ ;_ ¥* "-"??_ ;_ @_ ',
  45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mm:ss.0', 48: '##0.0E+0', 49: '@',
  50: 'yyyy"年"m"月"', 51: 'm"月"d"日"', 52: 'yyyy"年"m"月"', 53: 'm"月"d"日"', 54: 'm"月"d"日"',
  55: '上午/下午h"时"mm"分"', 56: '上午/下午h"时"mm"分"ss"秒"', 57: 'yyyy"年"m"月"', 58: 'm"月"d"日"',
  59: '0', 60: '0.00', 61: '#,##0', 62: '#,##0.00', 63: '¥#,##0;¥-#,##0', 64: '¥#,##0;[Red]¥-#,##0',
  65: '¥#,##0.00;¥-#,##0.00', 66: '¥#,##0.00;[Red]¥-#,##0.00', 67: '0%', 68: '0.00%', 69: '# ?/?', 70: '# ??/??',
  71: 'yyyy/m/d', 72: 'yyyy/m/d', 73: 'd-mmm-yy', 74: 'd-mmm', 75: 'mmm-yy', 76: 'h:mm', 77: 'h:mm:ss',
  78: 'yyyy/m/d h:mm', 79: 'mm:ss', 80: '[h]:mm:ss', 81: 'mm:ss.0',
};

/** Resolve a cell's numFmtId against the workbook's custom codes, then the zh-CN built-ins. */
/**
 * Readers report built-in ids as `#14` (see xlsx_formats.rs) and custom formats as their
 * code; turn either into a format code formatNumber understands.
 */
export function resolveFormatCode(code: string): string {
  const m = /^#(\d+)$/.exec(code);
  if (!m) return code;
  return BUILTIN_FORMATS_ZH_CN[Number(m[1])] ?? 'General';
}

const COLOR_NAMES: Record<string, string> = {
  红色: 'Red', 黑色: 'Black', 蓝色: 'Blue', 绿色: 'Green', 白色: 'White', 黄色: 'Yellow', 洋红: 'Magenta', 青色: 'Cyan',
};

/** Split on `;` outside quotes, brackets and escapes. */
function splitSections(code: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let bracket = false;
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '\\' && !quoted) {
      cur += ch + (code[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '[') bracket = true;
    else if (!quoted && ch === ']') bracket = false;
    if (ch === ';' && !quoted && !bracket) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Map each character outside quotes / brackets / escapes through `fn`. */
function mapUnquoted(section: string, fn: (ch: string, next: string) => string | null): string {
  let out = '';
  let quoted = false;
  for (let i = 0; i < section.length; i += 1) {
    const ch = section[i];
    if (ch === '"') {
      quoted = !quoted;
      out += ch;
    } else if (quoted) {
      out += ch;
    } else if (ch === '\\') {
      out += ch + (section[i + 1] ?? '');
      i += 1;
    } else if (ch === '[') {
      const end = section.indexOf(']', i);
      out += end === -1 ? section.slice(i) : section.slice(i, end + 1);
      i = end === -1 ? section.length : end;
    } else {
      const mapped = fn(ch, section[i + 1] ?? '');
      if (mapped === null) {
        i += 1; // consumed `next` as well
      } else {
        out += mapped;
      }
    }
  }
  return out;
}


/** Characters SSF does not treat as literals but Excel does. */
const LITERALS = new Set(['¥', '￥', '€', '£', '元', '円', '₩']);
const COLOR = /\[(?:Red|Black|Blue|Green|White|Yellow|Magenta|Cyan|Color\d+)\]/gi;
const CONDITION = /^\[(<=|>=|<>|<|>|=)(-?\d+(?:\.\d+)?)\]/;

interface Section {
  code: string;
  /** zh-CN `上午/下午` marker: rendered through SSF's AM/PM and translated back. */
  ampmZh: boolean;
  condition: ((v: number) => boolean) | null;
}

function parseCondition(op: string, n: number): (v: number) => boolean {
  switch (op) {
    case '<': return (v) => v < n;
    case '>': return (v) => v > n;
    case '<=': return (v) => v <= n;
    case '>=': return (v) => v >= n;
    case '=': return (v) => v === n;
    default: return (v) => v !== n;
  }
}

/** `_x` reserves the width of x, `*x` repeats x to fill the column: one space / one x. */
function replaceAlignment(section: string): string {
  let out = '';
  let quoted = false;
  for (let i = 0; i < section.length; i += 1) {
    const ch = section[i];
    if (ch === '"') {
      quoted = !quoted;
      out += ch;
    } else if (quoted) {
      out += ch;
    } else if (ch === '\\') {
      out += ch + (section[i + 1] ?? '');
      i += 1;
    } else if (ch === '_') {
      out += '" "';
      i += 1;
    } else if (ch === '*') {
      const fill = section[i + 1] ?? ' ';
      out += fill === ' ' || fill === '"' ? '" "' : `"${fill}"`;
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

function normalizeSection(raw: string): Section {
  let s = raw.replace(/\[([^\]$]+)\]/g, (m, name: string) => (COLOR_NAMES[name] ? '' : m)).replace(COLOR, '');
  let condition: Section['condition'] = null;
  const cond = CONDITION.exec(s);
  if (cond) {
    condition = parseCondition(cond[1], Number(cond[2]));
    s = s.slice(cond[0].length);
  }
  s = s.replace(/^G\/通用格式$/, 'General');
  const ampmZh = s.includes('上午/下午');
  if (ampmZh) s = s.split('上午/下午').join('AM/PM');
  s = replaceAlignment(s);
  // `!x` is an escape like `\x`.
  s = s.replace(/!(.)/g, '\\$1');
  // Currency symbols and CJK characters are literals in Excel but rejected by SSF.
  s = mapUnquoted(s, (ch) => (LITERALS.has(ch) || /[　-鿿＀-￯]/.test(ch) ? `"${ch}"` : ch));
  return { code: s, ampmZh, condition };
}

const cache = new Map<string, Section[]>();

function prepare(code: string): Section[] {
  let hit = cache.get(code);
  if (!hit) {
    hit = splitSections(code).map(normalizeSection);
    cache.set(code, hit);
  }
  return hit;
}

/**
 * Excel works with 15 significant digits and rounds halves away from zero; binary floats
 * make 1.005 or 2035548.4999999998 round down. Normalise to 15 digits, then nudge a few
 * ulps away from zero so exact decimal halves round like Excel.
 */
const NUDGE = Number.EPSILON * 4;

function excelValue(v: number): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  return Number(v.toPrecision(15)) * (1 + NUDGE);
}

/**
 * Pure digit templates such as `000-0000` or `00000`: SSF drops digits that do not fit,
 * Excel puts the overflow in front of the first placeholder.
 */
function digitTemplate(code: string, v: number): string | null {
  // Fractions (`# ?/?`) also use `/`; SSF handles those, this only covers digit masks.
  if (code.includes('/') || !/^(?:[0#?]|"[^"]*"|\\.|[- ():])+$/.test(code)) return null;
  const tokens: { ph: string | null; lit: string }[] = [];
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '"') {
      const end = code.indexOf('"', i + 1);
      tokens.push({ ph: null, lit: code.slice(i + 1, end) });
      i = end;
    } else if (ch === '\\') {
      tokens.push({ ph: null, lit: code[i + 1] ?? '' });
      i += 1;
    } else if (ch === '0' || ch === '#' || ch === '?') {
      tokens.push({ ph: ch, lit: '' });
    } else {
      tokens.push({ ph: null, lit: ch });
    }
  }
  if (!tokens.some((t) => t.ph === null && t.lit.trim() !== '')) return null;
  let digits = String(Math.round(v));
  if (digits === '0') digits = '';
  const out = tokens.map((t) => t.lit);
  let first = -1;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const ph = tokens[i].ph;
    if (!ph) continue;
    first = i;
    const d = digits.slice(-1);
    digits = digits.slice(0, -1);
    out[i] = d || (ph === '0' ? '0' : ph === '?' ? ' ' : '');
  }
  if (digits && first >= 0) out[first] = digits + out[first];
  return out.join('');
}

/** Last continued-fraction convergent with denominator <= maxD (Excel's fraction rule). */
function convergent(x: number, maxD: number): [number, number] {
  let [p0, q0, p1, q1] = [0, 1, 1, 0];
  let best: [number, number] = [0, 1];
  let n = x;
  for (let i = 0; i < 64; i += 1) {
    const a = Math.floor(n);
    const p2 = p0 + a * p1;
    const q2 = q0 + a * q1;
    if (q2 > maxD) break;
    [p0, q0, p1, q1] = [p1, q1, p2, q2];
    best = [p2, q2];
    const f = n - a;
    if (f < 1e-12) break;
    n = 1 / f;
  }
  return best;
}

/**
 * Fraction formats `# ?/?`, `# ??/??`, `?/8`. Mixed form shows the whole part and drops a
 * zero fraction; a fixed denominator rounds the numerator. Returns null for other codes.
 */
function fraction(code: string, v: number): string | null {
  const m = /^(#+\s+)?(\?+)\/(\?+|\d+)$/.exec(code);
  if (!m) return null;
  const mixed = Boolean(m[1]);
  const fixed = /^\d+$/.test(m[3]) ? Number(m[3]) : 0;
  // Undo the rounding nudge and keep only the digits Excel has: 98765432.1 - 98765432 is
  // 0.0999999940… in binary but 0.1 to Excel, and the convergents depend on that.
  const x = Number((v / (1 + NUDGE)).toPrecision(15));
  const whole = mixed ? Math.floor(x) : 0;
  const intDigits = whole > 0 ? String(whole).length : 0;
  const frac = Number((x - whole).toPrecision(Math.max(1, 15 - intDigits)));
  let num: number;
  let den: number;
  if (fixed) {
    den = fixed;
    num = Math.round(frac * fixed);
    // Measured in desktop Excel: an improper fraction over a fixed denominator shows #
    // once the numerator needs more than 5 digits (?/8: 9877/8 shows, 98765/8 does not).
    if (!mixed && num >= 100000) return '#';
  } else {
    [num, den] = convergent(frac, 10 ** m[3].length - 1);
  }
  let w = whole;
  if (mixed && num === den) {
    w += 1;
    num = 0;
  }
  if (mixed && num === 0) return String(w);
  const f = `${num}/${den}`;
  // An empty whole part still occupies its placeholder: Excel shows "- 1/2" for -0.5.
  if (mixed) return w > 0 ? `${w} ${f}` : ` ${f}`;
  return f;
}

/** Date / time / duration format (a number under it is a point in time or elapsed time). */
export function isDateFormat(code: string): boolean {
  try {
    return XLSX.SSF.is_date(code);
  } catch {
    return false;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Canonical raw text of a date serial, identical for every reader: `2024-01-31` for a
 * whole day, `13:45:41` below 1, otherwise `2024-01-31 13:45:41`. Same calendar rules as
 * Excel (1900 leap-year bug, 1904 system), seconds rounded like Excel's `ss`.
 */
export function serialToText(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  const p = XLSX.SSF.parse_date_code(serial, { date1904 });
  if (!p) return null;
  const date = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  const time = `${pad(p.H)}:${pad(p.M)}:${pad(p.S)}`;
  if (serial < 1 && !date1904) return time;
  if (Number.isInteger(serial)) return date;
  return `${date} ${time}`;
}

/** Excel fills a cell with # when the value cannot be shown under its format. */
export const OVERFLOW = '############';

class Overflow extends Error {}

function render(section: Section, v: number): string {
  const frac = fraction(section.code, v);
  if (frac === '#') throw new Overflow();
  if (frac !== null) return frac;
  // Engineering notation of zero: Excel fills every integer placeholder with 0.
  if (v === 0 && /^#+0\.0*E\+0+$/i.test(section.code)) {
    const [int, frac] = section.code.split('.');
    return `${'0'.repeat(int.length)}.${frac}`;
  }
  let text = digitTemplate(section.code, v) ?? XLSX.SSF.format(section.code, v);
  if (section.ampmZh) text = text.replace(/AM/g, '上午').replace(/PM/g, '下午');
  return text;
}

/** True when the section carries its own sign: a literal "-" or parentheses. */
function hasOwnSign(section: Section): boolean {
  return /^[^0#?]*[-(]/.test(section.code.replace(/"[^"]*"/g, (q) => (q.includes('-') || q.includes('(') ? '-' : '')));
}

/**
 * Render a number the way desktop Excel shows it for `code`. Returns null for General,
 * text-only codes, and codes that cannot be parsed, so callers show the raw value.
 */
/**
 * Excel's General format at a wide column: up to 11 characters, switching to scientific
 * notation when the number does not fit (3.14159265358979 -> 3.141592654,
 * 123456789012 -> 1.23457E+11). Narrow columns show fewer digits; the table sizes its
 * columns to content, so the wide rendering is the reference.
 */
export function formatGeneral(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return XLSX.SSF.format('General', excelValue(value));
}

export function formatNumber(value: number, code: string): string | null {
  if (!code || code === 'General' || code === 'G/通用格式') return null;
  if (code === '@') return formatGeneral(value);
  const sections = prepare(code);
  // A 4th section only formats text; the first three cover positive / negative / zero.
  const numeric = sections.slice(0, 3);
  const v = excelValue(value);
  // Dates and times cannot be negative; Excel fills the cell with #.
  if (v < 0 && numeric.length < 2 && XLSX.SSF.is_date(numeric[0].code)) return OVERFLOW;
  try {
    let text: string;
    if (numeric.some((s) => s.condition)) {
      // Conditional sections: first matching condition wins, otherwise the first plain
      // section. Excel prints "-" itself unless the chosen section writes its own sign.
      const hit = numeric.find((s) => s.condition?.(v)) ?? numeric.find((s) => !s.condition) ?? numeric[0];
      text = render(hit, Math.abs(v));
      if (v < 0 && !hasOwnSign(hit)) text = `-${text}`;
    } else if (v < 0 && numeric.length >= 2) {
      text = render(numeric[1], -v);
    } else if (v === 0 && numeric.length >= 3) {
      text = render(numeric[2], 0);
    } else if (v < 0) {
      text = `-${render(numeric[0], -v)}`;
    } else {
      text = render(numeric[0], v);
    }
    text = text.replace(/\s+/g, ' ').trim();
    // Excel never shows "-0": a negative value that rounds to zero drops its sign.
    if (/^-/.test(text) && /\d/.test(text) && !/[1-9]/.test(text)) text = text.slice(1).trim();
    return text;
  } catch (err) {
    return err instanceof Overflow ? OVERFLOW : null;
  }
}

/** Text cells: only a 4th (text) section changes them; otherwise they show as stored. */
export function formatText(value: string, code: string): string | null {
  if (!code || code === 'General' || code === 'G/通用格式' || code === '@') return null;
  const sections = prepare(code);
  if (sections.length < 4 || !sections[3].code.includes('@')) return null;
  try {
    return XLSX.SSF.format(sections[3].code, value).replace(/\s+/g, ' ').trim();
  } catch {
    return null;
  }
}
