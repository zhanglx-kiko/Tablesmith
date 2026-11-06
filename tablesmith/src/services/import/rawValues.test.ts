// Red line: importing never changes a stored value. Every imported cell is compared with
// the cell at the same sheet address in desktop Excel (Range.Value2, captured by
// scripts/excel-reference.ps1): numbers must read back as the same double, text must be
// byte-identical, dates must be the canonical text of the same serial. Display formatting
// may change how a value looks; never the value calculations, filters and exports use.
//
// The one structural transform: a vertically merged label is copied into the rows it spans
// ("华东" over two rows becomes "华东" on both), so grouping and pivots see it. Excel stores
// the value only in the merge's first cell; the copy is checked against that cell.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ReadFileResponse } from './index';
import { normalizeSheetDetailed } from './normalize';
import { serialToText } from './numberFormat';
import { readWorkbookWithSheetJs } from './sheetjsReader';
import type { RawWorkbook } from './types';

const EDGE = join(__dirname, '../../../sample-data/edge-cases');
const REF = join(__dirname, '../../../sample-data/excel-reference');
const PRIVATE_REF = join(__dirname, '../../../src-tauri/target/excel-reference');
const PAYLOADS = join(__dirname, '../../../src-tauri/target/import-payloads');

/** type: n = number (value in round-trip form), s = text, b = boolean, e = error. */
type RefCell = [row: number, col: number, value: string, format: string, text: string, type: 'n' | 's' | 'b' | 'e'];
interface Ref {
  sheets: { name: string; cells: RefCell[] }[];
}

/** The raw text Excel's stored value must import as (null: any text is fine, e.g. errors). */
function expectedRaw(cell: RefCell | undefined, imported: string): string | null {
  if (!cell) return '';
  const [, , value, , , type] = cell;
  if (type === 'e') return null;
  if (type === 'b') return value.toUpperCase();
  if (type === 's') return value;
  // A number imports as the same double, or as the date text of that same serial (date
  // formats; the SheetJS fallback keeps the serial for zh-CN Chinese date built-ins).
  const n = Number(value);
  if (imported.trim() !== '' && Number(imported) === n) return imported;
  return serialToText(n, false) ?? value;
}

function check(workbook: RawWorkbook, ref: Ref): { checked: number; problems: string[] } {
  const problems: string[] = [];
  let checked = 0;
  for (const rs of ref.sheets) {
    const raw = workbook.sheets.find((s) => s.name === rs.name);
    if (!raw) {
      problems.push(`sheet ${rs.name} missing`);
      continue;
    }
    const byAddress = new Map(rs.cells.map((c) => [`${c[0]},${c[1]}`, c]));
    const [r0, c0] = raw.origin;
    const mergeAnchor = (r: number, c: number): RefCell | undefined => {
      const m = raw.merges.find(([a, b, d, e]) => a <= r - r0 && r - r0 <= d && b <= c - c0 && c - c0 <= e);
      return m ? byAddress.get(`${m[0] + r0},${m[1] + c0}`) : undefined;
    };
    const tables = normalizeSheetDetailed(raw, [], { spreadsheet: true, date1904: workbook.date1904 });
    for (const { table, rows, cols } of tables) {
      table.rows.forEach((row, i) =>
        row.forEach((ours, j) => {
          const r = rows[i] + r0;
          const c = cols[j] + c0;
          let cell = byAddress.get(`${r},${c}`);
          if (!cell && ours !== '') cell = mergeAnchor(r, c);
          const expected = expectedRaw(cell, ours);
          checked += 1;
          if (expected !== null && ours !== expected) {
            problems.push(`${rs.name}!R${r + 1}C${c + 1}: Excel stores ${JSON.stringify(cell?.[2] ?? '')} (${cell?.[5] ?? 'empty'}), imported ${JSON.stringify(ours)}`);
          }
        }),
      );
    }
  }
  return { checked, problems };
}

function desktopWorkbook(name: string): RawWorkbook | null {
  const p = join(PAYLOADS, `${name}.json`);
  if (!existsSync(p)) return null;
  const snap = JSON.parse(readFileSync(p, 'utf8')) as { ok?: ReadFileResponse };
  return snap.ok?.kind === 'workbook' ? snap.ok.workbook : null;
}

const load = (dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Ref;

const cases: { file: string; source: string; ref: () => Ref; minCells: number }[] = [
  { file: 'number_formats.xlsx', source: EDGE, ref: () => load(REF, 'number_formats.xlsx.json'), minCells: 1500 },
  { file: 'number_formats_excel.xls', source: EDGE, ref: () => load(REF, 'number_formats_excel.xls.json'), minCells: 1500 },
  { file: 'number_formats_excel.xlsb', source: EDGE, ref: () => load(REF, 'number_formats_excel.xlsb.json'), minCells: 1500 },
  { file: 'builtin_format_ids.xlsx', source: EDGE, ref: () => load(REF, 'builtin_format_ids.xlsx.json'), minCells: 300 },
  { file: 'text_whitespace.xlsx', source: EDGE, ref: () => load(REF, 'text_whitespace.xlsx.json'), minCells: 100 },
  { file: 'builtin_format_ids.xls', source: EDGE, ref: () => load(REF, 'builtin_format_ids.xls.json'), minCells: 300 },
  { file: 'builtin_format_ids.xlsb', source: EDGE, ref: () => load(REF, 'builtin_format_ids.xlsb.json'), minCells: 300 },
  // A real 19-sheet financial model (user file, not committed): runs where it exists.
  {
    file: 'Financial_BP_Rolling_Forecast.xlsx',
    source: 'D:/tmp/excel',
    ref: () => load(PRIVATE_REF, 'Financial_BP_Rolling_Forecast.xlsx.json'),
    minCells: 50000,
  },
];

describe('imported raw values equal what Excel stores', () => {
  for (const { file, source, ref, minCells } of cases) {
    const present = existsSync(join(source, file)) && (source === EDGE || existsSync(join(PRIVATE_REF, `${file}.json`)));
    it.skipIf(!present || !existsSync(join(PAYLOADS, `${file}.json`)))(`desktop: ${file}`, () => {
      const wb = desktopWorkbook(file);
      expect(wb, 'calamine could not read the file').not.toBeNull();
      const { checked, problems } = check(wb as RawWorkbook, ref());
      expect(problems.slice(0, 20)).toEqual([]);
      expect(checked).toBeGreaterThan(minCells);
    });
    it.skipIf(!present)(`fallback (SheetJS): ${file}`, () => {
      const wb = readWorkbookWithSheetJs(new Uint8Array(readFileSync(join(source, file))));
      const { checked, problems } = check(wb, ref());
      expect(problems.slice(0, 20)).toEqual([]);
      expect(checked).toBeGreaterThan(minCells);
    });
  }
});
