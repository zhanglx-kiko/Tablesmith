// End to end: what the table shows for each cell must equal what desktop Excel shows
// (Range.Text in sample-data/excel-reference). Covers every reader path:
//   - desktop: Rust payload snapshots (`cargo test --lib export_payloads -- --ignored`)
//     for xlsx and the Excel-saved xls / xlsb copies;
//   - SheetJS: the same files parsed from bytes (used when calamine returns `unparsed`).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SheetData } from '../../types';
import { parseDesktopPayload, parseFileBytes, type ReadFileResponse } from './index';

const EDGE = join(__dirname, '../../../sample-data/edge-cases');
const REF = join(__dirname, '../../../sample-data/excel-reference');
const PAYLOADS = join(__dirname, '../../../src-tauri/target/import-payloads');

type RefCell = [row: number, col: number, value: string, format: string, text: string];
interface Ref {
  sheets: { name: string; cells: RefCell[] }[];
}

// Excel repeats # to the column width; any run of # is the same overflow marker.
const visible = (t: string) => t.replace(/\s+/g, ' ').trim().replace(/^#{6,}$/, '#');

/**
 * Map Excel's (sheet, row, col) to the imported table cell. The fixtures have no merges
 * and at most one header row: number_formats has one, builtin_format_ids (all numbers)
 * has none and gets generated `列A` headers.
 */
function shown(sheet: SheetData, r: number, c: number): string | undefined {
  const headerRows = sheet.headers[0]?.startsWith('列') ? 0 : 1;
  const row = r - headerRows;
  if (row < 0) return sheet.headers[c];
  return sheet.display?.[row]?.[c] ?? sheet.rows[row]?.[c];
}

/**
 * Cells whose value is not in the file: `=1/0` is saved without a cached result (openpyxl
 * does not calculate), Excel computes `#DIV/0!` on open. The importer reports these as
 * uncached formulas instead of guessing.
 */
const NOT_IN_FILE = new Set(['文本与布尔!r5c1']);

function mismatches(sheets: SheetData[], ref: Ref): string[] {
  const out: string[] = [];
  for (const rs of ref.sheets) {
    const sheet = sheets.find((s) => s.name === rs.name);
    if (!sheet) {
      out.push(`sheet ${rs.name} missing`);
      continue;
    }
    for (const [r, c, , format, text] of rs.cells) {
      if (NOT_IN_FILE.has(`${rs.name}!r${r}c${c}`)) continue;
      const ours = shown(sheet, r, c);
      if (visible(ours ?? '') !== visible(text)) {
        out.push(`${rs.name}!r${r}c${c} ${JSON.stringify(format)}: excel=${JSON.stringify(text)} ours=${JSON.stringify(ours)}`);
      }
    }
  }
  return out;
}

function desktop(name: string): SheetData[] | null {
  const p = join(PAYLOADS, `${name}.json`);
  if (!existsSync(p)) return null;
  const snap = JSON.parse(readFileSync(p, 'utf8')) as { ok?: ReadFileResponse };
  if (!snap.ok || snap.ok.kind === 'unparsed') return null;
  return parseDesktopPayload(name, snap.ok).file.sheets;
}

function browser(name: string): SheetData[] {
  return parseFileBytes(name, new Uint8Array(readFileSync(join(EDGE, name)))).file.sheets;
}

const refFor = (file: string) => JSON.parse(readFileSync(join(REF, `${file}.json`), 'utf8')) as Ref;

describe('table display equals desktop Excel', () => {
  const cases: [file: string, ref: Ref][] = [
    ['number_formats.xlsx', refFor('number_formats.xlsx')],
    ['number_formats_excel.xlsb', refFor('number_formats_excel.xlsb')],
    ['number_formats_excel.xls', refFor('number_formats_excel.xls')],
    ['builtin_format_ids.xlsx', refFor('builtin_format_ids.xlsx')],
    ['builtin_format_ids.xlsb', refFor('builtin_format_ids.xlsb')],
    ['builtin_format_ids.xls', refFor('builtin_format_ids.xls')],
  ];
  for (const [file, ref] of cases) {
    it.skipIf(!existsSync(join(PAYLOADS, `${file}.json`)))(`desktop reader: ${file}`, () => {
      const sheets = desktop(file);
      expect(sheets, 'calamine could not read the file').not.toBeNull();
      expect(mismatches(sheets ?? [], ref)).toEqual([]);
    });
  }
  it('SheetJS reader: number_formats.xlsx', () => {
    expect(mismatches(browser('number_formats.xlsx'), refFor('number_formats.xlsx'))).toEqual([]);
  });
});
