import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { XMLBuilder } from 'fast-xml-parser';
import * as YAML from 'js-yaml';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { SheetData, ExportFormat } from '../types';
import { parseNumericCell } from '../utils/numberUtils';
import {
  ImportError,
  MAX_IMPORT_BYTES,
  SUPPORTED_EXTENSIONS,
  assertSupported,
  parseClipboardText,
  type ImportResult,
  type ReadFileResponse,
} from './import';
import { parseBytesInWorker, parsePayloadInWorker } from './import/client';

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

  if (isTauriEnv()) {
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
 * Check if the application is running inside Tauri desktop environment.
 */
export function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Resolves a non-colliding file path. In Tauri desktop mode, calls the backend command
 * to append (1), (2), etc. if the file already exists in the target directory.
 * In browser mode, returns the provided path unchanged.
 */
export async function getUniqueFilePath(fullPath: string): Promise<string> {
  if (isTauriEnv()) {
    try {
      const unique: string = await invoke('get_unique_filepath', { path: fullPath });
      return unique;
    } catch (err) {
      console.warn('Failed to resolve unique filepath via Tauri:', err);
      return fullPath;
    }
  }
  return fullPath;
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

/** Desktop: Rust reads the file (calamine / encoding detection); the worker builds tables. */
export async function importFromPath(path: string, signal?: AbortSignal): Promise<ImportResult> {
  const fileName = baseName(path);
  assertSupported(fileName);
  const response = await invoke<ReadFileResponse>('read_file_data', { path });
  if (response.kind !== 'unparsed') return parsePayloadInWorker(fileName, response, signal);
  const bytes = await invoke<ArrayBuffer>('read_file_bytes', { path });
  return parseBytesInWorker(fileName, bytes, signal);
}

/** Browser: read the File and parse it in the worker. */
export async function importFromBrowserFile(file: File, signal?: AbortSignal): Promise<ImportResult> {
  assertSupported(file.name);
  if (file.size > MAX_IMPORT_BYTES) {
    throw new ImportError(`文件超过 ${MAX_IMPORT_BYTES / 1024 / 1024} MB，暂不支持导入`);
  }
  return parseBytesInWorker(file.name, await file.arrayBuffer(), signal);
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

export async function importBrowserFiles(files: File[], signal?: AbortSignal): Promise<ImportOutcome[]> {
  const out: ImportOutcome[] = [];
  for (const file of files) out.push(await settle(file.name, () => importFromBrowserFile(file, signal)));
  return out;
}

/** Show the system picker (or a browser file input) and return the chosen files' outcomes. */
export async function pickAndImportFiles(signal?: AbortSignal): Promise<ImportOutcome[]> {
  if (isTauriEnv()) {
    const selected = await open({
      multiple: true,
      filters: [{ name: '数据文件', extensions: [...SUPPORTED_EXTENSIONS] }],
    });
    if (!selected) return [];
    const paths = Array.isArray(selected) ? selected : [selected];
    return importPaths(paths, signal);
  }
  const files = await pickBrowserFiles();
  return importBrowserFiles(files, signal);
}

function pickBrowserFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(',');

    let resolved = false;
    const finish = (files: File[]) => {
      if (resolved) return;
      resolved = true;
      window.removeEventListener('focus', onWindowFocus);
      input.remove();
      resolve(files);
    };
    input.onchange = () => finish(Array.from(input.files ?? []));
    input.addEventListener('cancel', () => finish([]));
    // Older WebViews do not dispatch `cancel`; a focus return with no selection means dismissed.
    const onWindowFocus = () => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) finish([]);
      }, 400);
    };
    window.addEventListener('focus', onWindowFocus, { once: true });
    input.click();
  });
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
 * Export a sheet to the specified format via Tauri save dialog / browser download.
 */
export async function exportFile(
  data: SheetData,
  format: ExportFormat,
  fileName: string,
  targetDirectory?: string,
): Promise<{ saved: boolean; fileName: string; path?: string }> {
  let textContent: string | null = null;
  let binaryContent: Uint8Array | null = null;
  let extension = format as string;
  let mimeType = 'text/plain';

  const records = data.rows.map((row) => {
    const obj: Record<string, string> = {};
    data.headers.forEach((h, i) => {
      obj[h] = row[i] ?? '';
    });
    return obj;
  });

  switch (format) {
    case 'csv': {
      textContent = Papa.unparse(records);
      mimeType = 'text/csv';
      break;
    }
    case 'json': {
      textContent = JSON.stringify(records, null, 2);
      mimeType = 'application/json';
      break;
    }
    case 'xlsx': {
      const ws = XLSX.utils.json_to_sheet(records);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, data.name || 'Sheet1');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      binaryContent = new Uint8Array(buf);
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      break;
    }
    case 'xml': {
      const builder = new XMLBuilder({
        format: true,
        ignoreAttributes: false,
        arrayNodeName: 'row',
      });
      textContent = builder.build({ data: { row: records } }) as string;
      mimeType = 'application/xml';
      break;
    }
    case 'yaml': {
      textContent = YAML.dump(records);
      extension = 'yaml';
      mimeType = 'text/yaml';
      break;
    }
    case 'sql': {
      const tableName = (data.name || 'table_data').replace(/[^a-zA-Z0-9_]/g, '_') || 'table_data';
      const cols = data.headers.map((h) => `\`${h.replace(/`/g, '')}\``).join(', ');
      const insertStatements = data.rows.map((row) => {
        const values = row
          .map((val) => {
            if (val === null || val === undefined || val === '') return 'NULL';
            const num = parseNumericCell(val);
            if (!isNaN(num) && !/[a-zA-Z\s]/.test(String(val))) return String(num);
            return `'${String(val).replace(/'/g, "''")}'`;
          })
          .join(', ');
        return `INSERT INTO \`${tableName}\` (${cols}) VALUES (${values});`;
      });
      textContent =
        `-- Tablesmith Export\n-- Table: ${tableName}\n-- Date: ${new Date().toISOString()}\n\n` +
        insertStatements.join('\n');
      extension = 'sql';
      mimeType = 'application/sql';
      break;
    }
  }

  const fullFileName = `${fileName}.${extension}`;

  if (isTauriEnv()) {
    let savePath = '';
    const resolvedDir = (targetDirectory && targetDirectory.trim()) || getLastExportDir();

    if (resolvedDir) {
      savePath = `${resolvedDir.replace(/[\\/]+$/, '')}\\${fullFileName}`;
    } else {
      // Fallback only if no directory was provided or remembered
      const picked = await save({
        defaultPath: fullFileName,
        filters: [{ name: format.toUpperCase(), extensions: [extension] }],
      });
      if (!picked) return { saved: false, fileName: fullFileName };
      savePath = picked;
    }

    // Safeguard: auto-number with (1), (2) if the file already exists in destination
    savePath = await getUniqueFilePath(savePath);

    if (binaryContent) {
      await invoke('save_binary_file', {
        path: savePath,
        data: Array.from(binaryContent),
      });
    } else if (textContent !== null) {
      await invoke('save_file', {
        path: savePath,
        content: textContent,
      });
    }

    // Persist this directory for all future exports
    const lastSlash = Math.max(savePath.lastIndexOf('\\'), savePath.lastIndexOf('/'));
    if (lastSlash > 0) {
      setLastExportDir(savePath.substring(0, lastSlash));
    }

    // Extract actual file name (in case it was auto-numbered)
    const actualFileName = savePath.substring(lastSlash + 1) || fullFileName;

    return { saved: true, fileName: actualFileName, path: savePath };
  }

  // Browser fallback: trigger file download via Blob
  const blob = binaryContent
    ? new Blob([binaryContent.buffer as ArrayBuffer], { type: mimeType })
    : new Blob([textContent || ''], { type: mimeType });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fullFileName;
  a.click();
  URL.revokeObjectURL(url);
  return { saved: true, fileName: fullFileName };
}
