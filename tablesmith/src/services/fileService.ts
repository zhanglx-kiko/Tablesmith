import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { XMLBuilder } from 'fast-xml-parser';
import * as YAML from 'js-yaml';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { SheetData, ExportFormat } from '../types';
import {
  ImportError,
  SUPPORTED_EXTENSIONS,
  assertSupported,
  parseClipboardText,
  type ImportResult,
  type ReadFileResponse,
} from './import';
import { parseBytesInWorker, parsePayloadInWorker } from './import/client';
import { exactNumber } from './import/cellText';

export { ImportError, SUPPORTED_EXTENSIONS, type ImportResult } from './import';

export const LAST_EXPORT_DIR_KEY = 'tablesmith_last_export_dir';

/** Shown next to import controls; derived from the parser's own extension list. */
export const SUPPORTED_FORMATS_LABEL = 'Excel（.xlsx .xlsm .xlsb .xls）、ODS、CSV / TSV / TXT、JSON / JSONL、XML、XSD、YAML';

/**
 * Retrieve the user's previously chosen export directory from local storage.
 */
export function getLastExportDir(): string {
  try {
    return (typeof window !== 'undefined' ? localStorage.getItem(LAST_EXPORT_DIR_KEY) : null) || '';
  } catch {
    return '';
  }
}

/**
 * Persist the latest chosen export directory into local storage.
 */
export function setLastExportDir(dir: string): void {
  try {
    if (typeof window !== 'undefined' && dir && dir.trim() !== '') {
      localStorage.setItem(LAST_EXPORT_DIR_KEY, dir.trim());
    }
  } catch {
    // ignore
  }
}

/**
 * Resolve the real default export directory.
 * Priority:
 * 1. Previously remembered export directory from localStorage
 * 2. Real OS Download directory via Tauri path API
 * 3. Real OS Document directory fallback
 */
export async function resolveDefaultExportDir(): Promise<string> {
  const last = getLastExportDir();
  if (last) return last;

  {
    try {
      const { downloadDir, documentDir } = await import('@tauri-apps/api/path');
      const d = await downloadDir();
      if (d) {
        const cleaned = d.replace(/[\\/]+$/, '');
        setLastExportDir(cleaned);
        return cleaned;
      }
      const doc = await documentDir();
      if (doc) {
        const cleaned = doc.replace(/[\\/]+$/, '');
        setLastExportDir(cleaned);
        return cleaned;
      }
    } catch (err) {
      console.warn('Failed to resolve system downloadDir:', err);
    }
  }
  return '';
}

/**
 * Resolve a non-colliding path: the Rust command appends (1), (2), ... when the target exists.
 */
export async function getUniqueFilePath(fullPath: string): Promise<string> {
  return invoke<string>('get_unique_filepath', { path: fullPath });
}

export interface SaveResult {
  saved: boolean;
  fileName: string;
  path?: string;
}

/**
 * Write exported bytes or text to disk. Uses the chosen (or remembered) directory without
 * a second dialog, falls back to a save dialog when no directory is known, never overwrites
 * an existing file, and remembers the directory for the next export.
 */
export async function saveExport(
  fullFileName: string,
  content: Uint8Array | string,
  filter: { name: string; extensions: string[] },
  targetDirectory?: string,
): Promise<SaveResult> {
  const dir = (targetDirectory && targetDirectory.trim()) || getLastExportDir();
  let savePath: string;
  if (dir) {
    savePath = `${dir.replace(/[\\/]+$/, '')}\\${fullFileName}`;
  } else {
    const picked = await save({ defaultPath: fullFileName, filters: [filter] });
    if (!picked) return { saved: false, fileName: fullFileName };
    savePath = picked;
  }
  savePath = await getUniqueFilePath(savePath);

  if (typeof content === 'string') {
    await invoke('save_file', { path: savePath, content });
  } else {
    await invoke('save_binary_file', { path: savePath, data: Array.from(content) });
  }

  const lastSlash = Math.max(savePath.lastIndexOf('\\'), savePath.lastIndexOf('/'));
  if (lastSlash > 0) setLastExportDir(savePath.substring(0, lastSlash));
  return { saved: true, fileName: savePath.substring(lastSlash + 1) || fullFileName, path: savePath };
}

// ── import ───────────────────────────────────────────────────────────

/** One file's import outcome; a batch never stops at the first failure. */
export type ImportOutcome =
  | { ok: true; fileName: string; result: ImportResult }
  | { ok: false; fileName: string; message: string };

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Turn any thrown value into text a user can act on. */
export function describeImportError(err: unknown): string {
  if (err instanceof ImportError) return err.message;
  if (typeof err === 'string') return err;
  if (err instanceof Error) return `解析失败：${err.message}`;
  return '解析失败：未知错误';
}

/** Rust reads the file (calamine / encoding detection); the worker builds tables. */
export async function importFromPath(path: string, signal?: AbortSignal): Promise<ImportResult> {
  const fileName = baseName(path);
  assertSupported(fileName);
  const response = await invoke<ReadFileResponse>('read_file_data', { path });
  if (response.kind !== 'unparsed') return parsePayloadInWorker(fileName, response, signal);
  const bytes = await invoke<ArrayBuffer>('read_file_bytes', { path });
  return parseBytesInWorker(fileName, bytes, signal);
}

async function settle(fileName: string, run: () => Promise<ImportResult>): Promise<ImportOutcome> {
  try {
    return { ok: true, fileName, result: await run() };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return { ok: false, fileName, message: describeImportError(err) };
  }
}

/** Import files one after another so a huge workbook does not hold several copies in memory. */
export async function importPaths(paths: string[], signal?: AbortSignal): Promise<ImportOutcome[]> {
  const out: ImportOutcome[] = [];
  for (const path of paths) out.push(await settle(baseName(path), () => importFromPath(path, signal)));
  return out;
}

/** Show the system picker and import the chosen files. */
export async function pickAndImportFiles(signal?: AbortSignal): Promise<ImportOutcome[]> {
  const selected = await open({
    multiple: true,
    filters: [{ name: '数据文件', extensions: [...SUPPORTED_EXTENSIONS] }],
  });
  if (!selected) return [];
  return importPaths(Array.isArray(selected) ? selected : [selected], signal);
}

export type FileDropEvent = { type: 'over' } | { type: 'leave' } | { type: 'drop'; paths: string[] };

/**
 * Subscribe to native file drops on the window. Tauri intercepts OS drag and drop
 * (`dragDropEnabled`), so HTML drop events never fire; this is the only drop source.
 */
export function onFileDrop(handler: (event: FileDropEvent) => void): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;
  void getCurrentWebview()
    .onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === 'enter' || p.type === 'over') handler({ type: 'over' });
      else if (p.type === 'leave') handler({ type: 'leave' });
      else handler({ type: 'drop', paths: p.paths });
    })
    .then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/**
 * Read table data directly from user clipboard (e.g. copied from Excel, Google Sheets, or web table).
 */
export async function importFromClipboard(): Promise<ImportResult> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    throw new ImportError('无法读取剪贴板，请允许剪贴板访问权限后重试');
  }
  const now = new Date();
  const timeStr = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((n) => n.toString().padStart(2, '0'))
    .join('');
  return parseClipboardText(text, `剪贴板数据_${timeStr}.csv`);
}

/**
 * Export a sheet to the specified format and write it to disk.
 */
/** What an export writes: stored raw values (default) or the text shown in Excel format. */
export type ExportContent = 'raw' | 'display';

/** Cell values to export; `display` falls back to raw where a cell has no Excel text. */
export function exportRows(data: SheetData, content: ExportContent): string[][] {
  if (content === 'raw' || !data.display) return data.rows;
  return data.rows.map((row, r) => row.map((v, c) => data.display?.[r]?.[c] || v));
}

/**
 * A sheet name Excel accepts: at most 31 characters, none of : \ / ? * [ ], no leading or
 * trailing apostrophe, not empty and not the reserved "History". Only the sheet tab name
 * changes; cell values are untouched.
 */
export function excelSheetName(name: string): string {
  let out = name.replace(/[:\\/?*[\]]/g, '_').replace(/^'+|'+$/g, '').trim();
  if (out === '' || out.toLowerCase() === 'history') out = out === '' ? 'Sheet1' : `${out}_1`;
  if (out.length <= 31) return out;
  // Excel counts UTF-16 code units (an emoji is 2); never split a surrogate pair.
  let cut = out.slice(0, 31);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return cut.replace(/'+$/, '');
}

export { exactNumber };

export interface BuiltExport {
  extension: string;
  payload: string | Uint8Array;
}

/** Serialise a sheet in the given format (pure; `exportFile` adds the save dialog). */
export function buildExport(data: SheetData, format: ExportFormat, content: ExportContent = 'raw'): BuiltExport {
  let textContent: string | null = null;
  let binaryContent: Uint8Array | null = null;
  let extension = format as string;

  const rows = exportRows(data, content);
  const records = rows.map((row) => {
    const obj: Record<string, string> = {};
    data.headers.forEach((h, i) => {
      obj[h] = row[i] ?? '';
    });
    return obj;
  });

  switch (format) {
    case 'csv': {
      textContent = Papa.unparse(records);
      break;
    }
    case 'json': {
      textContent = JSON.stringify(records, null, 2);
      break;
    }
    case 'xlsx': {
      const ws = XLSX.utils.aoa_to_sheet([data.headers, ...rows.map((row) => row.map((v) => exactNumber(v) ?? v))]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, excelSheetName(data.name));
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      binaryContent = new Uint8Array(buf);
      break;
    }
    case 'xml': {
      const builder = new XMLBuilder({
        format: true,
        ignoreAttributes: false,
        arrayNodeName: 'row',
      });
      textContent = builder.build({ data: { row: records } }) as string;
      break;
    }
    case 'yaml': {
      textContent = YAML.dump(records);
      extension = 'yaml';
      break;
    }
    case 'sql': {
      const tableName = (data.name || 'table_data').replace(/[^a-zA-Z0-9_]/g, '_') || 'table_data';
      const cols = data.headers.map((h) => `\`${h.replace(/`/g, '')}\``).join(', ');
      const insertStatements = rows.map((row) => {
        const values = row
          .map((val) => {
            if (val === null || val === undefined || val === '') return 'NULL';
            const num = exactNumber(val);
            if (num !== null) return val;
            return `'${String(val).replace(/'/g, "''")}'`;
          })
          .join(', ');
        return `INSERT INTO \`${tableName}\` (${cols}) VALUES (${values});`;
      });
      textContent =
        `-- Tablesmith Export\n-- Table: ${tableName}\n-- Date: ${new Date().toISOString()}\n\n` +
        insertStatements.join('\n');
      extension = 'sql';
      break;
    }
  }

  return { extension, payload: binaryContent ?? textContent ?? '' };
}

export async function exportFile(
  data: SheetData,
  format: ExportFormat,
  fileName: string,
  targetDirectory?: string,
  content: ExportContent = 'raw',
): Promise<SaveResult> {
  const { extension, payload } = buildExport(data, format, content);
  return saveExport(`${fileName}.${extension}`, payload, { name: format.toUpperCase(), extensions: [extension] }, targetDirectory);
}
