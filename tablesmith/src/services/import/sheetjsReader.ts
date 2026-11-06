import * as XLSX from 'xlsx';
import { looksDate } from './cellText';
import { xlsxExcelTexts } from './xlsxText';
import { ImportError, type GridCell, type MergeRange, type RawSheet, type RawWorkbook } from './types';

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * Convert an Excel serial date into the same text the Rust reader produces
 * (`format_excel_datetime` in commands.rs): serial < 1 is a time of day, a whole
 * number is a date, anything else is a date with time.
 */
export function formatExcelSerial(serial: number, date1904: boolean): string | null {
  const parsed = XLSX.SSF.parse_date_code(serial, { date1904 });
  if (!parsed) return null;
  const date = `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`;
  const time = `${pad(parsed.H)}:${pad(parsed.M)}:${pad(Math.round(parsed.S))}`;
  if (serial < 1) return time;
  if (Number.isInteger(serial)) return date;
  return `${date} ${time}`;
}

function toGridCell(cell: XLSX.CellObject | undefined, date1904: boolean): GridCell {
  if (!cell) return null;
  switch (cell.t) {
    case 'n': {
      const value = cell.v as number;
      const format = typeof cell.z === 'string' ? cell.z : '';
      // ODS carries no format code, only the rendered text, so fall back to that.
      const isDate = format ? XLSX.SSF.is_date(format) : looksDate(cell.w ?? '');
      if (isDate) {
        const text = formatExcelSerial(value, date1904);
        if (text) return { date: text, serial: value };
      }
      return value;
    }
    case 'd': {
      const value = cell.v;
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const iso = value.toISOString();
        return { date: iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ') };
      }
      return null;
    }
    case 'b':
      return Boolean(cell.v);
    case 'e':
      return { error: cell.w ?? '#ERROR' };
    case 's':
      return cell.v === undefined || cell.v === null ? null : String(cell.v);
    default:
      return null;
  }
}

/**
 * SheetJS expands built-in format ids with its en-US table (`m/d/yy` for 14). Map those
 * codes back to `#<id>` so they resolve with the zh-CN table like the Rust reader's.
 * The table is one-to-one for ids 0-81, so the reverse lookup is unambiguous.
 */
const BUILTIN_BY_CODE = new Map<string, number>(
  Object.entries(XLSX.SSF.get_table())
    .filter((entry): entry is [string, string] => Number(entry[0]) < 82 && typeof entry[1] === 'string')
    .map(([id, code]): [string, number] => [code, Number(id)]),
);

function sheetJsFormat(cell: XLSX.CellObject | undefined): string {
  const z = typeof cell?.z === 'string' ? cell.z : '';
  const id = BUILTIN_BY_CODE.get(z);
  return id === undefined || id === 0 ? z : `#${id}`;
}

function sheetToRaw(
  ws: XLSX.WorkSheet,
  name: string,
  hidden: boolean,
  date1904: boolean,
): { sheet: RawSheet; unknownFormatCells: number } {
  const dense = (ws['!data'] ?? []) as (XLSX.CellObject | undefined)[][];
  const cells: GridCell[][] = [];
  const cellFormats: number[][] = [];
  const formats: string[] = [];
  const formatIndex = new Map<string, number>();
  let uncachedFormulas = 0;
  let unknownFormatCells = 0;
  for (let r = 0; r < dense.length; r += 1) {
    const src = dense[r] ?? [];
    const row: GridCell[] = [];
    const fmtRow: number[] = [];
    for (let c = 0; c < src.length; c += 1) {
      const cell = src[c];
      if (cell && cell.t === 'z' && cell.f) uncachedFormulas += 1;
      row.push(toGridCell(cell, date1904));
      if (cell?.t === 'n' && cell.z === undefined && cell.w !== undefined && cell.w !== String(cell.v)) {
        unknownFormatCells += 1;
      }
      const z = sheetJsFormat(cell);
      if (!z || z === 'General') {
        fmtRow.push(-1);
      } else {
        let i = formatIndex.get(z);
        if (i === undefined) {
          i = formats.length;
          formats.push(z);
          formatIndex.set(z, i);
        }
        fmtRow.push(i);
      }
    }
    while (row.length > 0 && row[row.length - 1] === null) {
      row.pop();
      fmtRow.pop();
    }
    cells.push(row);
    cellFormats.push(fmtRow);
  }
  while (cells.length > 0 && cells[cells.length - 1].length === 0) {
    cells.pop();
    cellFormats.pop();
  }

  const merges: MergeRange[] = (ws['!merges'] ?? []).map((m) => [m.s.r, m.s.c, m.e.r, m.e.c]);
  // SheetJS dense data is indexed by the real sheet address.
  return { sheet: { name, hidden, origin: [0, 0], cells, merges, uncachedFormulas, formats, cellFormats }, unknownFormatCells };
}

function describeSheetJsError(err: unknown): ImportError {
  const message = err instanceof Error ? err.message : String(err);
  if (/password|encrypt/i.test(message)) {
    return new ImportError('文件设置了打开密码，请在 Excel 中取消密码后再导入');
  }
  return new ImportError(`无法识别的表格文件：${message}`);
}

/** Read any SheetJS-supported container (xlsx/xlsm/xlsb/xls/ods, SpreadsheetML, HTML tables). */
export function readWorkbookWithSheetJs(bytes: Uint8Array): RawWorkbook {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: 'array', dense: true, cellNF: true, cellDates: false, sheetStubs: true });
  } catch (err) {
    throw describeSheetJsError(err);
  }
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);
  const meta = wb.Workbook?.Sheets ?? [];
  // xlsx / xlsm (zip): apply Excel's text whitespace rule, which SheetJS does not.
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const excelTexts = isZip ? xlsxExcelTexts(bytes, wb.SheetNames) : new Map<string, Map<string, string>>();
  let unknownFormats = 0;
  const sheets = wb.SheetNames.map((name, i) => {
    const hidden = Boolean(meta[i]?.Hidden);
    const raw = sheetToRaw(wb.Sheets[name], name, hidden, date1904);
    unknownFormats += raw.unknownFormatCells;
    const texts = excelTexts.get(name);
    if (texts) {
      for (const [key, text] of texts) {
        const [r, c] = key.split(',').map(Number);
        const row = raw.sheet.cells[r];
        if (row && typeof row[c] === 'string') row[c] = text === '' ? null : text;
      }
    }
    return raw.sheet;
  });
  const notices: string[] = [];
  if (unknownFormats > 0) {
    // zh-CN built-ins (27-36, 50-58) are not in SheetJS's table and the code is not in the
    // file, so these cells keep their stored number.
    notices.push(`${unknownFormats} 个单元格使用了本工具无法识别的 Excel 内置格式，按存储的数值显示`);
  }
  return { sheets, notices, date1904 };
}
