import type { FileData, SheetData } from '../../types';
import { decodeText } from './decode';
import { readDelimited } from './delimited';
import { normalizeWorkbook } from './normalize';
import { readWorkbookWithSheetJs } from './sheetjsReader';
import { parseJsonText, parseYamlText } from './structured';
import { ImportError, type RawWorkbook } from './types';
import { xmlToSheets } from './xml';
import { xsdToSheets } from './xsd';

export { ImportError } from './types';

/** Files above this size are rejected before parsing; mirrors MAX_IMPORT_BYTES in import.rs. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

export const SPREADSHEET_EXTENSIONS = ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods'] as const;
export const TEXT_EXTENSIONS = ['csv', 'tsv', 'txt', 'json', 'jsonl', 'ndjson', 'xml', 'xsd', 'yaml', 'yml'] as const;
export const SUPPORTED_EXTENSIONS: readonly string[] = [...SPREADSHEET_EXTENSIONS, ...TEXT_EXTENSIONS];

const SINGLE_SHEET_NAME = 'Sheet1';

export interface ImportResult {
  file: FileData;
  /** Non-fatal observations worth telling the user (hidden sheets, encoding, skipped content). */
  notices: string[];
}

/**
 * Parsed payloads returned by the Rust `read_file_data` command (see `ReadPayload` in
 * import.rs). Its third variant, `{ kind: 'unparsed' }`, means calamine could not read
 * the workbook and the caller must fetch the bytes and use `parseFileBytes` instead.
 */
export type DesktopPayload =
  | { kind: 'workbook'; workbook: RawWorkbook }
  | { kind: 'text'; text: string; encoding: string };

export type ReadFileResponse = DesktopPayload | { kind: 'unparsed'; reason: string };

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

export function assertSupported(fileName: string): string {
  const ext = extensionOf(fileName);
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    const shown = ext ? `.${ext}` : '无扩展名';
    throw new ImportError(`不支持的文件类型（${shown}）。支持：${SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(' ')}`);
  }
  return ext;
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function isOle(bytes: Uint8Array): boolean {
  return [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((b, i) => bytes[i] === b);
}

function looksLikeSheetJsText(text: string): boolean {
  const head = text.slice(0, 2048).toLowerCase();
  return (
    head.includes('urn:schemas-microsoft-com:office:spreadsheet') ||
    head.includes('progid="excel.sheet"') ||
    /<table[\s>]/.test(head)
  );
}

function finish(fileName: string, ext: string, sheets: SheetData[], notices: string[]): ImportResult {
  const usable = sheets.filter((s) => s.headers.length > 0);
  if (usable.length === 0) throw new ImportError('文件中没有可读取的表格数据');
  return { file: { fileName, fileType: ext, sheets: usable }, notices };
}

function fromWorkbook(fileName: string, ext: string, workbook: RawWorkbook, extra: string[] = []): ImportResult {
  const normalized = normalizeWorkbook(workbook);
  return finish(fileName, ext, normalized.sheets, [...extra, ...normalized.notices]);
}

/** Parse already-decoded text according to the file extension. */
export function parseText(fileName: string, text: string, encoding: string): ImportResult {
  const ext = assertSupported(fileName);
  const notices: string[] = [];
  if (encoding !== 'utf-8') notices.push(`已按 ${encoding.toUpperCase()} 编码读取`);
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.trim() === '') throw new ImportError('文件内容为空');

  if (looksLikeSheetJsText(body) && (SPREADSHEET_EXTENSIONS as readonly string[]).includes(ext)) {
    notices.push('该文件实际是网页 / XML 表格格式，已按表格读取');
    return fromWorkbook(fileName, ext, readWorkbookWithSheetJs(new TextEncoder().encode(body)), notices);
  }

  switch (ext) {
    case 'json':
      return finish(fileName, ext, parseJsonText(body, SINGLE_SHEET_NAME, false), notices);
    case 'jsonl':
    case 'ndjson':
      return finish(fileName, ext, parseJsonText(body, SINGLE_SHEET_NAME, true), notices);
    case 'yaml':
    case 'yml':
      return finish(fileName, ext, parseYamlText(body, SINGLE_SHEET_NAME), notices);
    case 'xsd':
      return finish(fileName, ext, xsdToSheets(body), notices);
    case 'xml':
      if (looksLikeSheetJsText(body)) {
        return fromWorkbook(fileName, ext, readWorkbookWithSheetJs(new TextEncoder().encode(body)), notices);
      }
      return finish(fileName, ext, xmlToSheets(body), notices);
    case 'tsv':
      return fromWorkbook(fileName, ext, readDelimited(body, SINGLE_SHEET_NAME, '\t'), notices);
    default:
      // csv, txt, and spreadsheet extensions whose content turned out to be plain text
      if (!['csv', 'txt'].includes(ext)) notices.push('该文件实际是纯文本，已按分隔符文本读取');
      return fromWorkbook(fileName, ext, readDelimited(body, SINGLE_SHEET_NAME), notices);
  }
}

/** Parse a file's raw bytes with SheetJS / text decoding (used when calamine returns `unparsed`, and by tests). */
export function parseFileBytes(fileName: string, bytes: Uint8Array): ImportResult {
  const ext = assertSupported(fileName);
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ImportError(`文件超过 ${MAX_IMPORT_BYTES / 1024 / 1024} MB，暂不支持导入`);
  }
  if (bytes.byteLength === 0) throw new ImportError('文件内容为空');
  if ((SPREADSHEET_EXTENSIONS as readonly string[]).includes(ext)) {
    if (isOle(bytes) && ext !== 'xls') {
      throw new ImportError('文件设置了打开密码，请在 Excel 中取消密码后再导入');
    }
    if (isZip(bytes) || isOle(bytes)) {
      return fromWorkbook(fileName, ext, readWorkbookWithSheetJs(bytes));
    }
  }
  const decoded = decodeText(bytes);
  return parseText(fileName, decoded.text, decoded.encoding);
}

/** Rust already read the file (calamine for workbooks, encoding detection for text). */
export function parseDesktopPayload(fileName: string, payload: DesktopPayload): ImportResult {
  const ext = assertSupported(fileName);
  if (payload.kind === 'workbook') return fromWorkbook(fileName, ext, payload.workbook);
  return parseText(fileName, payload.text, payload.encoding);
}

/** Clipboard text copied from Excel, WPS, Google Sheets or a web page. */
export function parseClipboardText(text: string, fileName: string): ImportResult {
  if (text.trim() === '') throw new ImportError('剪贴板为空，请先在 Excel 或网页中复制表格内容');
  const delimiter = text.includes('\t') ? '\t' : undefined;
  return fromWorkbook(fileName, 'csv', readDelimited(text, SINGLE_SHEET_NAME, delimiter));
}
