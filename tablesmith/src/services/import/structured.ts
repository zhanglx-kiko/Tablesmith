import * as YAML from 'js-yaml';
import type { SheetData } from '../../types';
import { formatNumber } from './cellText';
import { uniqueHeaders } from './normalize';
import { ImportError } from './types';

/** Nested objects become dotted columns up to this depth; deeper values are kept as JSON text. */
const FLATTEN_DEPTH = 4;
/** How deep to look for arrays of records inside wrapper objects such as `{ data: { items: [...] } }`. */
const SEARCH_DEPTH = 4;
export const META_SHEET_NAME = '元信息';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecordArray(value: unknown): value is Json[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const objects = value.filter(isObject).length;
  return objects / value.length >= 0.5;
}

function scalarText(value: Json): string {
  if (value === null) return '';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function valueText(value: Json): string {
  if (Array.isArray(value)) {
    return value.every((v) => !isObject(v) && !Array.isArray(v))
      ? value.map(scalarText).join(', ')
      : JSON.stringify(value);
  }
  return scalarText(value);
}

function flattenInto(target: Map<string, string>, value: Json, prefix: string, depth: number): void {
  if (isObject(value) && depth < FLATTEN_DEPTH && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) {
      flattenInto(target, child, prefix ? `${prefix}.${key}` : key, depth + 1);
    }
    return;
  }
  target.set(prefix || '值', valueText(value));
}

function recordsToSheet(name: string, items: Json[]): SheetData {
  const flat = items.map((item) => {
    const row = new Map<string, string>();
    flattenInto(row, item, '', 0);
    return row;
  });
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of flat) {
    for (const key of row.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return {
    name,
    headers: uniqueHeaders(columns),
    rows: flat.map((row) => columns.map((c) => row.get(c) ?? '')),
  };
}

interface Found {
  path: string[];
  items: Json[];
}

function collect(value: Json, path: string[], depth: number, tables: Found[], meta: Map<string, string>): void {
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (isRecordArray(child)) {
      tables.push({ path: childPath, items: child });
    } else if (isObject(child) && depth < SEARCH_DEPTH) {
      collect(child, childPath, depth + 1, tables, meta);
    } else {
      meta.set(childPath.join('.'), valueText(child));
    }
  }
}

function tableName(found: Found, all: Found[]): string {
  const last = found.path[found.path.length - 1];
  const clash = all.filter((f) => f.path[f.path.length - 1] === last).length > 1;
  return clash ? found.path.join('.') : last;
}

/**
 * Turn a parsed JSON / YAML document into tables:
 * - a top-level array becomes one table;
 * - arrays of objects found inside wrapper objects become one table each, and the
 *   remaining scalar fields go into a key/value "元信息" table;
 * - a plain object with no record arrays becomes a single-row table.
 */
export function documentToSheets(doc: unknown, rootName: string): SheetData[] {
  const value = doc as Json;
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    const items = value.map((v) => (isObject(v) ? v : ({ 值: v } as JsonObject)));
    return [recordsToSheet(rootName, items)];
  }
  if (!isObject(value)) {
    return value === undefined ? [] : [{ name: rootName, headers: ['值'], rows: [[valueText(value)]] }];
  }
  const tables: Found[] = [];
  const meta = new Map<string, string>();
  collect(value, [], 0, tables, meta);
  if (tables.length === 0) return [recordsToSheet(rootName, [value])];

  const sheets = tables.map((t) => recordsToSheet(tableName(t, tables), t.items));
  if (meta.size > 0) {
    sheets.push({
      name: META_SHEET_NAME,
      headers: ['字段', '值'],
      rows: [...meta.entries()].map(([k, v]) => [k, v]),
    });
  }
  return sheets;
}

function jsonErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const lineCol = /line (\d+) column (\d+)/.exec(message);
  if (lineCol) return `JSON 格式错误（第 ${lineCol[1]} 行第 ${lineCol[2]} 列附近）：${message}`;
  return `JSON 格式错误：${message}`;
}

/** Parse JSON, or JSON Lines (one object per line) when the whole text is not valid JSON. */
export function parseJsonText(text: string, rootName: string, preferLines: boolean): SheetData[] {
  const trimmed = text.trim();
  if (trimmed === '') throw new ImportError('文件内容为空');
  if (!preferLines) {
    try {
      return documentToSheets(JSON.parse(trimmed), rootName);
    } catch (err) {
      const lines = trimmed.split(/\r?\n/).filter((l) => l.trim() !== '');
      if (lines.length < 2 || !lines.every((l) => /^\s*[[{]/.test(l))) {
        throw new ImportError(jsonErrorMessage(err));
      }
    }
  }
  const items: Json[] = [];
  trimmed.split(/\r?\n/).forEach((line, idx) => {
    if (line.trim() === '') return;
    try {
      items.push(JSON.parse(line) as Json);
    } catch (err) {
      throw new ImportError(`第 ${idx + 1} 行不是有效的 JSON：${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return documentToSheets(items, rootName);
}

export function parseYamlText(text: string, rootName: string): SheetData[] {
  let docs: unknown[];
  try {
    docs = YAML.loadAll(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ImportError(`YAML 格式错误：${message}`);
  }
  const nonEmpty = docs.filter((d) => d !== null && d !== undefined);
  if (nonEmpty.length === 0) throw new ImportError('文件内容为空');
  return documentToSheets(nonEmpty.length === 1 ? nonEmpty[0] : nonEmpty, rootName);
}
