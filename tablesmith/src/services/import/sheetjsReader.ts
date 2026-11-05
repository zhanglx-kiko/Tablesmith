import * as XLSX from 'xlsx';
import { looksDate } from './cellText';
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
        if (text) return { date: text };
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

function sheetToRaw(ws: XLSX.WorkSheet, name: string, hidden: boolean, date1904: boolean): RawSheet {
  const dense = (ws['!data'] ?? []) as (XLSX.CellObject | undefined)[][];
  const cells: GridCell[][] = [];
  let uncachedFormulas = 0;
  for (let r = 0; r < dense.length; r += 1) {
    const src = dense[r] ?? [];
    const row: GridCell[] = [];
    for (let c = 0; c < src.length; c += 1) {
      const cell = src[c];
      if (cell && cell.t === 'z' && cell.f) uncachedFormulas += 1;
      row.push(toGridCell(cell, date1904));
    }
    while (row.length > 0 && row[row.length - 1] === null) row.pop();
    cells.push(row);
  }
  while (cells.length > 0 && cells[cells.length - 1].length === 0) cells.pop();

  const merges: MergeRange[] = (ws['!merges'] ?? []).map((m) => [m.s.r, m.s.c, m.e.r, m.e.c]);
  return { name, hidden, cells, merges, uncachedFormulas };
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
  const sheets = wb.SheetNames.map((name, i) => {
    const hidden = Boolean(meta[i]?.Hidden);
    return sheetToRaw(wb.Sheets[name], name, hidden, date1904);
  });
  return { sheets, notices: [] };
}
