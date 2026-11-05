import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { SheetData } from '../../types';
import { uniqueHeaders } from './normalize';
import { META_SHEET_NAME } from './structured';
import { ImportError } from './types';

interface XmlElement {
  tag: string;
  attrs: [string, string][];
  children: XmlElement[];
  text: string;
}

type OrderedNode = Record<string, unknown>;

function isNodeRecord(value: unknown): value is OrderedNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toElements(nodes: unknown): XmlElement[] {
  if (!Array.isArray(nodes)) return [];
  const out: XmlElement[] = [];
  for (const node of nodes) {
    if (!isNodeRecord(node)) continue;
    const tag = Object.keys(node).find((k) => k !== ':@' && k !== '#text');
    if (!tag) continue;
    const rawAttrs = node[':@'];
    const attrs: [string, string][] = isNodeRecord(rawAttrs)
      ? Object.entries(rawAttrs)
          .filter(([k]) => k !== 'xmlns' && !k.startsWith('xmlns:'))
          .map(([k, v]) => [k, String(v)])
      : [];
    const childNodes = node[tag];
    const texts: string[] = [];
    if (Array.isArray(childNodes)) {
      for (const child of childNodes) {
        if (isNodeRecord(child) && '#text' in child) texts.push(String(child['#text']));
      }
    }
    out.push({ tag, attrs, children: toElements(childNodes), text: texts.join(' ').trim() });
  }
  return out;
}

export function parseXmlTree(text: string): XmlElement {
  const validation = XMLValidator.validate(text);
  if (validation !== true) {
    const { line, col, msg } = validation.err;
    throw new ImportError(`XML 格式错误（第 ${line} 行第 ${col} 列）：${msg}`);
  }
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
    commentPropName: false,
  });
  const roots = toElements(parser.parse(text));
  if (roots.length === 0) throw new ImportError('XML 文件中没有元素');
  return roots[0];
}

const isLeaf = (el: XmlElement): boolean => el.children.length === 0;

interface Table {
  columns: string[];
  seen: Set<string>;
  rows: Map<string, string>[];
}

interface ParentRef {
  column: string;
  value: string;
}

class XmlTableBuilder {
  readonly tables = new Map<string, Table>();
  readonly meta: [string, string][] = [];

  private table(tag: string): Table {
    let t = this.tables.get(tag);
    if (!t) {
      t = { columns: [], seen: new Set(), rows: [] };
      this.tables.set(tag, t);
    }
    return t;
  }

  private addRecord(el: XmlElement, parent: ParentRef | null): void {
    const row = new Map<string, string>();
    const put = (key: string, value: string) => {
      const existing = row.get(key);
      row.set(key, existing ? `${existing}, ${value}` : value);
    };
    if (parent) put(parent.column, parent.value);
    for (const [k, v] of el.attrs) put(k, v);
    if (el.text) put(el.attrs.length > 0 || !isLeaf(el) ? '#text' : el.tag, el.text);

    const nested: XmlElement[] = [];
    for (const child of el.children) {
      for (const [k, v] of child.attrs) put(`${child.tag}@${k}`, v);
      if (child.text || (isLeaf(child) && child.attrs.length === 0)) put(child.tag, child.text);
      if (!isLeaf(child)) nested.push(child);
    }

    const t = this.table(el.tag);
    for (const key of row.keys()) {
      if (!t.seen.has(key)) {
        t.seen.add(key);
        t.columns.push(key);
      }
    }
    t.rows.push(row);

    const keyAttr = el.attrs.find(([k]) => /^(id|key|code|name)$/i.test(k)) ?? el.attrs[0];
    const ref = keyAttr ? { column: `${el.tag}.${keyAttr[0]}`, value: keyAttr[1] } : null;
    for (const child of nested) this.visit(child, ref, `${el.tag}.${child.tag}`);
  }

  visit(el: XmlElement, parent: ParentRef | null, path: string): void {
    const groups = new Map<string, XmlElement[]>();
    for (const child of el.children) {
      const list = groups.get(child.tag) ?? [];
      list.push(child);
      groups.set(child.tag, list);
    }
    const isContainer = groups.size === 1 && el.attrs.length === 0 && !el.text;

    for (const [tag, list] of groups) {
      const childPath = `${path}.${tag}`;
      const recordLike = list.some((c) => c.attrs.length > 0 || c.children.length > 0);
      if (recordLike && (list.length >= 2 || isContainer)) {
        list.forEach((c) => this.addRecord(c, parent));
      } else if (list.length >= 2) {
        this.meta.push([childPath, list.map((c) => c.text).join(', ')]);
      } else {
        const child = list[0];
        for (const [k, v] of child.attrs) this.meta.push([`${childPath}@${k}`, v]);
        if (child.text || (isLeaf(child) && child.attrs.length === 0)) this.meta.push([childPath, child.text]);
        if (!isLeaf(child)) this.visit(child, parent, childPath);
      }
    }
  }
}

/** Convert an XML document into one table per repeating element plus a key/value metadata table. */
export function xmlToSheets(text: string): SheetData[] {
  const root = parseXmlTree(text);
  const builder = new XmlTableBuilder();
  for (const [k, v] of root.attrs) builder.meta.push([`${root.tag}@${k}`, v]);
  if (root.text) builder.meta.push([root.tag, root.text]);
  builder.visit(root, null, root.tag);

  const sheets: SheetData[] = [];
  for (const [tag, t] of builder.tables) {
    sheets.push({
      name: tag,
      headers: uniqueHeaders(t.columns.map((c) => (c === '#text' ? `${tag}（文本）` : c))),
      rows: t.rows.map((row) => t.columns.map((c) => row.get(c) ?? '')),
    });
  }
  sheets.sort((a, b) => b.rows.length - a.rows.length);
  if (builder.meta.length > 0) {
    sheets.push({ name: META_SHEET_NAME, headers: ['字段', '值'], rows: builder.meta.map(([k, v]) => [k, v]) });
  }
  if (sheets.length === 0) throw new ImportError('XML 中没有可转换为表格的数据');
  return sheets;
}
