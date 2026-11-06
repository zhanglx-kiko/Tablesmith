import * as XLSX from 'xlsx';

/**
 * Excel's whitespace rule for xlsx text, applied in the SheetJS fallback the same way
 * xlsx_formats.rs applies it on the desktop path: a `<t>` / `<v>` without
 * `xml:space="preserve"` loses leading and trailing spaces, tabs and line breaks when Excel
 * opens the file (measured: sample-data/excel-reference/text_whitespace.xlsx.json). SheetJS
 * keeps them, so cells it read verbatim are corrected here.
 *
 * Returns, per sheet name, `"row,col" -> Excel's text` for the cells that change.
 */
export function xlsxExcelTexts(bytes: Uint8Array, sheetNames: string[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  let zip: { FullPaths: string[] };
  try {
    zip = XLSX.CFB.read(bytes, { type: 'array' }) as { FullPaths: string[] };
  } catch {
    return out;
  }
  const part = (path: string): string | null => {
    const entry = XLSX.CFB.find(zip, `/${path}`) as { content?: Uint8Array } | null;
    return entry?.content ? new TextDecoder('utf-8').decode(entry.content) : null;
  };

  const shared = sharedStrings(part('xl/sharedStrings.xml') ?? '');
  const parts = sheetParts(part('xl/workbook.xml') ?? '', part('xl/_rels/workbook.xml.rels') ?? '');
  for (const name of sheetNames) {
    const path = parts.get(name);
    const xml = path ? part(path) : null;
    if (xml) out.set(name, sheetTexts(xml, shared));
  }
  return out;
}

const XML_WS = /^[ \t\n\r]+|[ \t\n\r]+$/g;

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'amp') return '&';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  });
}

/** `(raw, excel)` for the text elements inside one `<si>` / `<is>` / `<v>`; phonetic runs skipped. */
function textOf(inner: string, element: 't' | 'v'): [string, string] {
  const body = inner.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
  const re = new RegExp(`<(?:\\w+:)?${element}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${element}>)`, 'g');
  let raw = '';
  let excel = '';
  for (const m of body.matchAll(re)) {
    const text = unescapeXml(m[2] ?? '');
    raw += text;
    excel += /xml:space\s*=\s*["']preserve["']/.test(m[1]) ? text : text.replace(XML_WS, '');
  }
  return [raw, excel];
}

function sharedStrings(xml: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)) {
    out.push(m[1] === undefined ? ['', ''] : textOf(m[1], 't'));
  }
  return out;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s(?:\\w+:)?${name}\\s*=\\s*"([^"]*)"`).exec(tag) ?? new RegExp(`\\s(?:\\w+:)?${name}\\s*=\\s*'([^']*)'`).exec(tag);
  return m ? unescapeXml(m[1]) : null;
}

function sheetParts(workbook: string, rels: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }
  const out = new Map<string, string>();
  for (const m of workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    const name = attr(m[0], 'name');
    const rid = attr(m[0], 'id');
    const target = rid ? targets.get(rid) : undefined;
    if (name && target) out.set(name, target);
  }
  return out;
}

function parseRef(ref: string): [number, number] | null {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]) - 1, col - 1];
}

function sheetTexts(xml: string, shared: [string, string][]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
    const t = attr(m[1], 't');
    if (t !== 's' && t !== 'inlineStr' && t !== 'str') continue;
    const pos = parseRef(attr(m[1], 'r') ?? '');
    if (!pos || m[2] === undefined) continue;
    let pair: [string, string] | undefined;
    if (t === 's') {
      const [idx] = textOf(m[2], 'v');
      pair = shared[Number(idx.trim())];
    } else if (t === 'inlineStr') {
      const is = /<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/.exec(m[2]);
      pair = is ? textOf(is[1], 't') : undefined;
    } else {
      pair = textOf(m[2], 'v');
    }
    if (pair && pair[0] !== pair[1]) out.set(`${pos[0]},${pos[1]}`, pair[1]);
  }
  return out;
}
