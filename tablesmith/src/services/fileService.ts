import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import * as YAML from 'js-yaml';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { FileData, SheetData, ExportFormat } from '../types';
import { parseNumericCell } from '../utils/numberUtils';

export const LAST_EXPORT_DIR_KEY = 'tablesmith_last_export_dir';

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

/**
 * Open a native file dialog (or browser file picker fallback) and read data.
 */
export async function openFileDialog(): Promise<FileData | null> {
  if (isTauriEnv()) {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Data Files',
            extensions: ['xlsx', 'xls', 'csv', 'json', 'xml', 'xsd', 'yaml', 'yml'],
          },
        ],
      });

      if (!selected) return null;

      const filePath = Array.isArray(selected) ? selected[0] : selected;
      if (!filePath) return null;

      const fileData: FileData = await invoke('read_file_data', { path: filePath });
      return parseFileData(fileData);
    } catch (err: unknown) {
      console.warn('Tauri open dialog cancelled or error:', err);
      return null;
    }
  }

  // Browser fallback for web preview/dev mode
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv,.json,.xml,.xsd,.yaml,.yml';

    let resolved = false;
    const finish = (val: FileData | null) => {
      if (resolved) return;
      resolved = true;
      window.removeEventListener('focus', onWindowFocus);
      input.remove();
      resolve(val);
    };

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      try {
        const data = await readBrowserFile(file);
        finish(data);
      } catch (err) {
        console.error('File parsing error:', err);
        finish(null);
      }
    };

    // Listen for cancel event when user dismisses the file picker without selecting
    input.addEventListener('cancel', () => {
      finish(null);
    });

    // Fallback focus check when cancel event is not dispatched by older WebViews
    const onWindowFocus = () => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) {
          finish(null);
        }
      }, 400);
    };
    window.addEventListener('focus', onWindowFocus, { once: true });

    input.click();
  });
}

/**
 * Read table data directly from user clipboard (e.g. copied from Excel, Google Sheets, or web table).
 */
export async function importFromClipboard(): Promise<FileData | null> {
  const text = await navigator.clipboard.readText();
  if (!text || text.trim() === '') {
    throw new Error('剪贴板为空，请先在 Excel 或网页中复制表格内容');
  }

  // Auto detect if it's tab-separated (from Excel/Sheets) or comma-separated
  const delimiter = text.includes('\t') ? '\t' : ',';
  const parsed = Papa.parse<string[]>(text.trim(), {
    delimiter,
    skipEmptyLines: 'greedy',
  });

  const allRows = parsed.data || [];
  if (allRows.length === 0) {
    throw new Error('未能从剪贴板解析出有效的行列数据');
  }

  const headers = (allRows[0] || []).map((h, i) => String(h || `列${i + 1}`).trim());
  const rows = allRows.slice(1).map((r) =>
    headers.map((_, i) => (r[i] !== undefined && r[i] !== null ? String(r[i]).trim() : ''))
  );

  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
  const fileName = `剪贴板数据_${timeStr}.csv`;

  return {
    fileName,
    fileType: 'csv',
    sheets: [
      {
        name: 'Sheet1',
        headers,
        rows,
      },
    ],
  };
}

/**
 * Detect the most likely header row index in raw spreadsheet rows,
 * penalizing single-cell title banners like "Revenue Build".
 */
export function detectHeaderRowIndex(rawRows: unknown[][]): number {
  if (!rawRows || rawRows.length <= 1) return 0;
  const maxInspect = Math.min(8, rawRows.length);
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < maxInspect; i++) {
    const row = rawRows[i] || [];
    const nonEmpty = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== '');
    const filledCount = nonEmpty.length;
    if (filledCount === 0) continue;

    const stringCount = nonEmpty.filter((c) => isNaN(Number(String(c).trim()))).length;
    const uniqueCount = new Set(nonEmpty.map((c) => String(c).trim())).size;

    let score = filledCount * 2 + stringCount * 1.5 + uniqueCount;
    if (filledCount === 1) {
      score = 0.5; // title banner penalty
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Normalizes raw spreadsheet rows into standard SheetData:
 * - Detects true header row
 * - De-duplicates and generates names for empty headers
 * - Normalizes row width
 * - Discards trailing empty lines
 */
export function normalizeSheetData(name: string, rawRows: unknown[][]): SheetData {
  if (!rawRows || rawRows.length === 0) {
    return { name, headers: [], rows: [] };
  }

  const headerIdx = detectHeaderRowIndex(rawRows);
  const rawHeaders = rawRows[headerIdx] || [];

  let maxCols = rawHeaders.length;
  for (const r of rawRows) {
    if (r && r.length > maxCols) maxCols = r.length;
  }
  if (maxCols === 0) maxCols = 1;

  const headers: string[] = [];
  const counts = new Map<string, number>();

  for (let c = 0; c < maxCols; c++) {
    let rawH = rawHeaders[c] !== null && rawHeaders[c] !== undefined ? String(rawHeaders[c]).trim() : '';
    if (!rawH) {
      rawH = `列${c + 1}`;
    }
    const count = counts.get(rawH) || 0;
    counts.set(rawH, count + 1);
    const finalH = count === 0 ? rawH : `${rawH}_${count}`;
    headers.push(finalH);
  }

  const rows: string[][] = [];
  for (let r = headerIdx + 1; r < rawRows.length; r++) {
    const rawRow = rawRows[r] || [];
    const hasData = rawRow.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '');
    if (!hasData) continue;

    const row: string[] = [];
    for (let c = 0; c < maxCols; c++) {
      const val = rawRow[c] !== null && rawRow[c] !== undefined ? String(rawRow[c]).trim() : '';
      row.push(val);
    }
    rows.push(row);
  }

  return { name, headers, rows };
}

function cleanTagName(name: string): string {
  const parts = name.split(':');
  return parts.length > 1 ? parts[1] : name;
}

/**
 * Specialized enterprise parser for XML Schema Definition (.xsd) files.
 * Extracts structured sheets: Elements, Attributes, SimpleTypes, Constraints, and SchemaSummary.
 */
export function extractSheetsFromXsd(parsed: Record<string, unknown>): SheetData[] {
  const schemaKey = Object.keys(parsed).find((k) => cleanTagName(k) === 'schema') || 'schema';
  const schema = (parsed[schemaKey] as Record<string, unknown>) || parsed;

  const elementsList: Record<string, string>[] = [];
  const attributesList: Record<string, string>[] = [];
  const simpleTypesList: Record<string, string>[] = [];
  const constraintsList: Record<string, string>[] = [];
  const schemaInfoList: Record<string, string>[] = [];

  // 1. Schema Info
  for (const [k, v] of Object.entries(schema)) {
    if (typeof v === 'string' || typeof v === 'number') {
      schemaInfoList.push({
        '属性名': cleanTagName(k),
        '属性值': String(v),
      });
    }
  }

  const toArray = (item: unknown): unknown[] => {
    if (!item) return [];
    return Array.isArray(item) ? item : [item];
  };

  // 2. SimpleTypes & Enumerations
  const simpleTypeNodes = toArray(schema['xs:simpleType'] || schema['simpleType']);
  for (const st of simpleTypeNodes) {
    if (typeof st !== 'object' || !st) continue;
    const stObj = st as Record<string, unknown>;
    const name = String(stObj['name'] || stObj['@_name'] || '');
    const restriction = (stObj['xs:restriction'] || stObj['restriction']) as Record<string, unknown> | undefined;
    const baseType = restriction ? String(restriction['base'] || restriction['@_base'] || '') : '';
    const enumNodes = restriction ? toArray(restriction['xs:enumeration'] || restriction['enumeration']) : [];
    const enumVals = enumNodes
      .map((en) =>
        en && typeof en === 'object'
          ? String((en as Record<string, unknown>)['value'] || (en as Record<string, unknown>)['@_value'] || '')
          : '',
      )
      .filter(Boolean);

    simpleTypesList.push({
      '类型名称': name,
      '基础数据类型': cleanTagName(baseType),
      '枚举候选值': enumVals.join(' | '),
    });
  }

  // 3. Elements, Attributes, Constraints
  function scanNode(node: unknown, parentScope: string) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((child) => scanNode(child, parentScope));
      return;
    }

    const obj = node as Record<string, unknown>;
    const elemName = String(obj['name'] || obj['@_name'] || '');
    const isElement = 'name' in obj && ('type' in obj || 'xs:complexType' in obj || 'complexType' in obj);

    let nextScope = parentScope;
    if (isElement && elemName) {
      nextScope = elemName;
      elementsList.push({
        '元素名称': elemName,
        '所属父节点': parentScope,
        '数据类型': cleanTagName(String(obj['type'] || obj['@_type'] || 'complexType')),
        '最小出现': String(obj['minOccurs'] || obj['@_minOccurs'] || '1'),
        '最大出现': String(obj['maxOccurs'] || obj['@_maxOccurs'] || '1'),
      });
    }

    const attrNodes = toArray(obj['xs:attribute'] || obj['attribute']);
    for (const at of attrNodes) {
      if (typeof at !== 'object' || !at) continue;
      const atObj = at as Record<string, unknown>;
      const atName = String(atObj['name'] || atObj['@_name'] || '');
      if (atName) {
        attributesList.push({
          '属性名称': atName,
          '所属元素': nextScope,
          '数据类型': cleanTagName(String(atObj['type'] || atObj['@_type'] || 'string')),
          '约束 (Use)': String(atObj['use'] || atObj['@_use'] || 'optional'),
          '默认值': String(atObj['default'] || atObj['@_default'] || ''),
        });
      }
    }

    const keyNodes = toArray(obj['xs:key'] || obj['key']);
    for (const kn of keyNodes) {
      if (typeof kn !== 'object' || !kn) continue;
      const knObj = kn as Record<string, unknown>;
      const kName = String(knObj['name'] || knObj['@_name'] || '');
      const selector = (knObj['xs:selector'] || knObj['selector']) as Record<string, unknown> | undefined;
      const field = (knObj['xs:field'] || knObj['field']) as Record<string, unknown> | undefined;
      constraintsList.push({
        '约束名称': kName,
        '约束类型': '主键 (Key)',
        '目标选择器 (Selector)': String(selector?.['xpath'] || selector?.['@_xpath'] || ''),
        '对应字段 (Field)': String(field?.['xpath'] || field?.['@_xpath'] || ''),
        '引用主键 (Refer)': '',
      });
    }

    const keyrefNodes = toArray(obj['xs:keyref'] || obj['keyref']);
    for (const kr of keyrefNodes) {
      if (typeof kr !== 'object' || !kr) continue;
      const krObj = kr as Record<string, unknown>;
      const krName = String(krObj['name'] || krObj['@_name'] || '');
      const refer = String(krObj['refer'] || krObj['@_refer'] || '');
      const selector = (krObj['xs:selector'] || krObj['selector']) as Record<string, unknown> | undefined;
      const field = (krObj['xs:field'] || krObj['field']) as Record<string, unknown> | undefined;
      constraintsList.push({
        '约束名称': krName,
        '约束类型': '外键 (KeyRef)',
        '目标选择器 (Selector)': String(selector?.['xpath'] || selector?.['@_xpath'] || ''),
        '对应字段 (Field)': String(field?.['xpath'] || field?.['@_xpath'] || ''),
        '引用主键 (Refer)': refer,
      });
    }

    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('?') || k.startsWith('@_')) continue;
      if (typeof v === 'object' && v !== null) {
        scanNode(v, nextScope);
      }
    }
  }

  scanNode(schema, 'Root');

  const sheets: SheetData[] = [];

  if (elementsList.length > 0) {
    const headers = ['元素名称', '所属父节点', '数据类型', '最小出现', '最大出现'];
    const rows = elementsList.map((r) => headers.map((h) => r[h] || ''));
    sheets.push({ name: 'Elements (元素结构)', headers, rows });
  }

  if (attributesList.length > 0) {
    const headers = ['属性名称', '所属元素', '数据类型', '约束 (Use)', '默认值'];
    const rows = attributesList.map((r) => headers.map((h) => r[h] || ''));
    sheets.push({ name: 'Attributes (字段属性)', headers, rows });
  }

  if (simpleTypesList.length > 0) {
    const headers = ['类型名称', '基础数据类型', '枚举候选值'];
    const rows = simpleTypesList.map((r) => headers.map((h) => r[h] || ''));
    sheets.push({ name: 'SimpleTypes (枚举与类型)', headers, rows });
  }

  if (constraintsList.length > 0) {
    const headers = ['约束名称', '约束类型', '目标选择器 (Selector)', '对应字段 (Field)', '引用主键 (Refer)'];
    const rows = constraintsList.map((r) => headers.map((h) => r[h] || ''));
    sheets.push({ name: 'Constraints (主外键约束)', headers, rows });
  }

  if (schemaInfoList.length > 0) {
    const headers = ['属性名', '属性值'];
    const rows = schemaInfoList.map((r) => headers.map((h) => r[h] || ''));
    sheets.push({ name: 'SchemaSummary (元信息)', headers, rows });
  }

  return sheets;
}

/**
 * Recursively extracts multi-sheet tabular data from parsed XML objects (with attributes support).
 */
export function extractSheetsFromParsedXml(parsed: Record<string, unknown>): SheetData[] {
  const rootKey = Object.keys(parsed).find((k) => !k.startsWith('?'));
  const root = rootKey ? (parsed[rootKey] as Record<string, unknown>) : parsed;
  const sheets: SheetData[] = [];

  function traverse(node: unknown, currentTag: string) {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      if (node.length > 0 && typeof node[0] === 'object') {
        const allKeys = new Set<string>();
        node.forEach((item) => {
          if (item && typeof item === 'object') {
            Object.keys(item as Record<string, unknown>).forEach((k) => allKeys.add(k));
          }
        });
        const headers = Array.from(allKeys).filter((k) => !k.startsWith('?'));
        const rows = node.map((item) =>
          headers.map((h) => {
            const val = (item as Record<string, unknown>)[h];
            if (val === undefined || val === null) return '';
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val).trim();
          }),
        );
        sheets.push({ name: cleanTagName(currentTag), headers: headers.map(cleanTagName), rows });
      }
      return;
    }

    const obj = node as Record<string, unknown>;
    for (const [key, val] of Object.entries(obj)) {
      if (key.startsWith('?') || key.startsWith('@_')) continue;
      if (Array.isArray(val)) {
        traverse(val, key);
      } else if (typeof val === 'object' && val !== null) {
        traverse(val, key);
      }
    }
  }

  traverse(root, rootKey ? cleanTagName(rootKey) : 'Sheet1');
  sheets.sort((a, b) => b.rows.length - a.rows.length);
  return sheets;
}

/**
 * Helper to parse a File object in browser environment.
 */
export async function readBrowserFile(file: File): Promise<FileData> {
  const fileName = file.name;
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  const buffer = await file.arrayBuffer();

  if (ext === 'xlsx' || ext === 'xls') {
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd' });
    const sheets: SheetData[] = workbook.SheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: false });
      return normalizeSheetData(sheetName, json);
    });
    return { fileName, fileType: ext, sheets };
  }

  // Multi-encoding text decoder with GB18030 / GBK fallback
  let text = '';
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    try {
      text = new TextDecoder('gb18030').decode(buffer);
    } catch {
      text = new TextDecoder('utf-8').decode(buffer);
    }
  }

  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  if (ext === 'csv') {
    const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: 'greedy' });
    const allRows = parsed.data || [];
    const sheet = normalizeSheetData('Sheet1', allRows);
    return {
      fileName,
      fileType: 'csv',
      sheets: [sheet],
    };
  }

  // JSON, XML, XSD, YAML
  return parseFileData({
    fileName,
    fileType: ext,
    sheets: [],
    rawContent: text,
  });
}

/**
 * Post-process raw file data — parse JSON / XML / XSD / YAML rawContent into sheets.
 */
export function parseFileData(fileData: FileData): FileData {
  // If Rust already parsed structured sheets with columns, keep them!
  if (fileData.sheets && fileData.sheets.length > 0 && fileData.sheets[0].headers.length > 0) {
    return fileData;
  }

  if (!fileData.rawContent) return fileData;

  const content = fileData.rawContent;

  try {
    switch (fileData.fileType) {
      case 'json': {
        const parsed: unknown = JSON.parse(content);
        const rows: Record<string, unknown>[] = Array.isArray(parsed)
          ? (parsed as Record<string, unknown>[])
          : [parsed as Record<string, unknown>];
        const headers = Array.from(
          rows.reduce<Set<string>>((keys, row) => {
            Object.keys(row).forEach((k) => keys.add(k));
            return keys;
          }, new Set<string>()),
        );
        const sheetRows = rows.map((row) =>
          headers.map((h) => {
            const v = row[h];
            return v === null || v === undefined ? '' : String(v);
          }),
        );
        return {
          ...fileData,
          sheets: [{ name: 'Sheet1', headers, rows: sheetRows }],
        };
      }
      case 'xsd': {
        const parser = new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: '',
        });
        const parsed = parser.parse(content) as Record<string, unknown>;
        const xsdSheets = extractSheetsFromXsd(parsed);
        if (xsdSheets.length > 0) {
          return {
            ...fileData,
            sheets: xsdSheets,
          };
        }
        break;
      }
      case 'xml': {
        const parser = new XMLParser({
          ignoreAttributes: false,
          attributeNamePrefix: '',
        });
        const parsed = parser.parse(content) as Record<string, unknown>;
        const xmlSheets = extractSheetsFromParsedXml(parsed);
        if (xmlSheets.length > 0) {
          return {
            ...fileData,
            sheets: xmlSheets,
          };
        }
        break;
      }
      case 'yaml':
      case 'yml': {
        const parsed: unknown = YAML.load(content);
        const rows: Record<string, unknown>[] = Array.isArray(parsed)
          ? (parsed as Record<string, unknown>[])
          : [parsed as Record<string, unknown>];
        const headers = Array.from(
          rows.reduce<Set<string>>((keys, row) => {
            Object.keys(row).forEach((k) => keys.add(k));
            return keys;
          }, new Set<string>()),
        );
        const sheetRows = rows.map((row) =>
          headers.map((h) => {
            const v = row[h];
            return v === null || v === undefined ? '' : String(v);
          }),
        );
        return {
          ...fileData,
          sheets: [{ name: 'Sheet1', headers, rows: sheetRows }],
        };
      }
      default:
        return fileData;
    }
  } catch {
    return fileData;
  }

  return fileData;
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
