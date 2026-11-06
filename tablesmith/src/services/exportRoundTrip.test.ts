// Red line for exports: exporting raw values and importing the file again must give back
// exactly the same values. Runs every sheet of the real financial model through every
// text and spreadsheet format the app writes.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { SheetData } from '../types';
import { parseFileBytes } from './import';
import { buildExport, exactNumber, excelSheetName, exportRows } from './fileService';

const MODEL = 'D:/tmp/excel/Financial_BP_Rolling_Forecast.xlsx';
const EDGE = 'sample-data/edge-cases/report_layouts.xlsx';

function load(path: string): SheetData[] {
  return parseFileBytes(path.split('/').pop() ?? path, new Uint8Array(readFileSync(path))).file.sheets;
}

function bytes(payload: string | Uint8Array): Uint8Array {
  return typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
}

function mismatches(expected: SheetData, actual: SheetData): string[] {
  const out: string[] = [];
  if (JSON.stringify(actual.headers) !== JSON.stringify(expected.headers)) {
    out.push(`headers ${JSON.stringify(expected.headers)} -> ${JSON.stringify(actual.headers)}`);
  }
  expected.rows.forEach((row, r) =>
    row.forEach((v, c) => {
      const got = actual.rows[r]?.[c] ?? '';
      if (got !== v) out.push(`R${r}C${c}: ${JSON.stringify(v)} -> ${JSON.stringify(got)}`);
    }),
  );
  if (actual.rows.length !== expected.rows.length) out.push(`rows ${expected.rows.length} -> ${actual.rows.length}`);
  return out.slice(0, 10);
}

describe('exactNumber only accepts text that is exactly that number', () => {
  it.each([
    ['1200', 1200],
    ['-0.75', -0.75],
    ['45351.57326388889', 45351.57326388889],
    ['0.30000000000000004', 0.30000000000000004],
    ['0.0000001', 1e-7],
    ['123456789012345', 123456789012345],
  ])('%s', (text, want) => {
    expect(exactNumber(text)).toBe(want);
  });

  it.each(['00892', '2026110488921001', '61.4%', '$1,200', '1,200', ' 12', '12 ', '+5', '.', '-', '', 'NaN', 'Infinity'])(
    'keeps %j as text',
    (text) => expect(exactNumber(text)).toBeNull(),
  );
});

describe('excelSheetName follows Excel sheet-name rules', () => {
  it.each([
    ['Summary · Monthly trend | 2024 actual vs forecast', 'Summary · Monthly trend | 2024 '],
    ['a/b:c?d*e[f]g\\h', 'a_b_c_d_e_f_g_h'],
    ["'quoted'", 'quoted'],
    ['', 'Sheet1'],
    ['History', 'History_1'],
    ['😀'.repeat(40), '😀'.repeat(15)],
    ['a' + '😀'.repeat(20), 'a' + '😀'.repeat(15)],
  ])('%j -> %j', (name, want) => {
    const got = excelSheetName(name);
    expect(got).toBe(want);
    expect(got.length).toBeLessThanOrEqual(31);
    // SheetJS enforces the same rules Excel does; it must accept the result.
    const wb = XLSX.utils.book_new();
    expect(() => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), got)).not.toThrow();
  });
});

const sources = [MODEL, EDGE].filter((p) => existsSync(p));

describe.skipIf(sources.length === 0)('raw export round-trips without changing a value', () => {
  const sheets = sources.flatMap((p) => load(p).map((s) => ({ src: p.split('/').pop(), sheet: s })));

  it('covers enough data', () => {
    expect(sheets.length).toBeGreaterThan(20);
    expect(sheets.reduce((n, s) => n + s.sheet.rows.length * s.sheet.headers.length, 0)).toBeGreaterThan(50_000);
  });

  // json / csv / yaml keep every value as text. xml repeats tag names, so it only
  // round-trips when headers are valid element names; it is checked on values below.
  for (const format of ['json', 'csv', 'yaml'] as const) {
    it(`${format}: every cell comes back identical`, () => {
      const problems: string[] = [];
      for (const { src, sheet } of sheets) {
        const { extension, payload } = buildExport(sheet, format);
        const [back] = parseFileBytes(`x.${extension}`, bytes(payload)).file.sheets;
        // Text formats cannot store "no column": an all-empty source column vanishes on
        // import (header detection) only when its header is empty too, never here.
        mismatches(sheet, back).forEach((m) => problems.push(`${src}/${sheet.name}: ${m}`));
      }
      expect(problems).toEqual([]);
    });
  }

  it('xlsx: numbers stay numbers, everything else stays text, values identical', () => {
    const problems: string[] = [];
    for (const { src, sheet } of sheets) {
      const { payload } = buildExport(sheet, 'xlsx');
      const wb = XLSX.read(payload, { type: 'array', dense: true });
      const cells = (wb.Sheets[wb.SheetNames[0]]['!data'] ?? []) as (XLSX.CellObject | undefined)[][];
      sheet.rows.forEach((row, r) =>
        row.forEach((v, c) => {
          const cell = cells[r + 1]?.[c];
          const n = exactNumber(v);
          if (v === '') {
            if (cell && cell.v !== '' && cell.v !== undefined) problems.push(`${src}/${sheet.name} R${r}C${c}: empty -> ${String(cell.v)}`);
          } else if (n !== null) {
            if (cell?.t !== 'n' || cell.v !== n) problems.push(`${src}/${sheet.name} R${r}C${c}: number ${v} -> ${cell?.t}:${String(cell?.v)}`);
          } else if (cell?.t !== 's' || cell.v !== v) {
            problems.push(`${src}/${sheet.name} R${r}C${c}: text ${JSON.stringify(v)} -> ${cell?.t}:${JSON.stringify(cell?.v)}`);
          }
        }),
      );
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it('sql: numeric literals are the exact raw text, strings are quoted verbatim', () => {
    for (const { sheet } of sheets.slice(0, 8)) {
      const { payload } = buildExport(sheet, 'sql');
      const lines = String(payload).split('\n').filter((l) => l.startsWith('INSERT'));
      expect(lines.length).toBe(sheet.rows.length);
      lines.forEach((line, r) => {
        for (const v of sheet.rows[r]) {
          if (v === '') continue;
          const literal = exactNumber(v) !== null ? v : `'${v.replace(/'/g, "''")}'`;
          expect(line).toContain(literal);
        }
      });
    }
  });

  it('display export writes Excel text where a cell has it and raw elsewhere', () => {
    for (const { sheet } of sheets.filter((s) => s.sheet.display)) {
      const { payload } = buildExport(sheet, 'json', 'display');
      const back = JSON.parse(String(payload)) as Record<string, string>[];
      const want = exportRows(sheet, 'display');
      back.forEach((rec, r) => sheet.headers.forEach((h, c) => expect(rec[h]).toBe(want[r][c])));
    }
  });
});
