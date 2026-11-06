// Formulas behind imported values, cell by cell against desktop Excel. Excel built
// sample-data/edge-cases/formulas.{xlsx,xls,xlsb} and reported every formula with
// Range.Formula (scripts/excel-formula-fixture.ps1 -> sample-data/excel-reference/formulas.json).
// Desktop xlsx formulas come from Rust (payload snapshots, `cargo test --lib export_payloads
// -- --ignored`); xls / xlsb and the fallback come from SheetJS.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SheetData } from '../../types';
import { parseDesktopPayload, parseFileBytes, type ReadFileResponse } from './index';

const ROOT = join(__dirname, '../../..');
const PAYLOADS = join(ROOT, 'src-tauri/target/import-payloads');

interface RefCell {
  sheet: string;
  row: number;
  col: number;
  formula: string;
  value: string;
}
const ref = JSON.parse(readFileSync(join(ROOT, 'sample-data/excel-reference/formulas.json'), 'utf8')) as RefCell[];

/**
 * Formulas by sheet address. The table's header is sheet row 0, so data row i is sheet
 * row i + 1 (the fixture has no title rows and no empty columns).
 */
function byAddress(sheets: SheetData[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of sheets) {
    s.formulas?.forEach((row, r) =>
      row.forEach((f, c) => {
        if (f !== null) out.set(`${s.name}!${r + 1},${c}`, f);
      }),
    );
  }
  return out;
}

// Header cells keep their text (a formula there names the column), and `=""` only blanks
// a cell out, so neither is shown.
const want = new Map(ref.filter((c) => c.row > 0 && c.formula !== '""').map((c) => [`${c.sheet}!${c.row},${c.col}`, c.formula]));

function check(sheets: SheetData[]): void {
  const got = byAddress(sheets);
  expect([...got].sort()).toEqual([...want].sort());
  // The value is still Excel's calculated value, never the formula.
  const orders = sheets.find((s) => s.name === '订单')!;
  for (const c of ref.filter((x) => x.sheet === '订单' && x.row > 0 && typeof x.value === 'string' && /^-?\d/.test(x.value))) {
    expect(Number(orders.rows[c.row - 1][c.col]), `${c.row},${c.col}`).toBeCloseTo(Number(c.value), 9);
  }
}

describe('formulas equal desktop Excel', () => {
  for (const ext of ['xlsx', 'xls', 'xlsb']) {
    it(`fallback reader: formulas.${ext}`, () => {
      check(parseFileBytes(`formulas.${ext}`, new Uint8Array(readFileSync(join(ROOT, `sample-data/edge-cases/formulas.${ext}`)))).file.sheets);
    });
  }
  for (const ext of ['xlsx', 'xls', 'xlsb']) {
    const snapshot = join(PAYLOADS, `formulas.${ext}.json`);
    it.skipIf(!existsSync(snapshot))(`desktop reader: formulas.${ext}`, () => {
      const payload = (JSON.parse(readFileSync(snapshot, 'utf8')) as { ok: ReadFileResponse }).ok;
      if (payload.kind !== 'workbook') throw new Error(payload.kind);
      // xlsx formulas come from Rust; xls / xlsb ones are read from the bytes.
      expect(Boolean(payload.workbook.formulasPending)).toBe(ext !== 'xlsx');
      const bytes = new Uint8Array(readFileSync(join(ROOT, `sample-data/edge-cases/formulas.${ext}`)));
      check(parseDesktopPayload(`formulas.${ext}`, payload, bytes).file.sheets);
    });
  }

  it('typed numbers in a formula column have no formula', () => {
    const s = parseFileBytes('formulas.xlsx', new Uint8Array(readFileSync(join(ROOT, 'sample-data/edge-cases/formulas.xlsx')))).file.sheets[0];
    const amount = s.headers.indexOf('amount');
    // D5 = 123.45 and D9 = 0 were typed over the filled-down =B*C.
    expect(s.formulas?.[3][amount]).toBeNull();
    expect(s.formulas?.[7][amount]).toBeNull();
    expect(s.formulas?.[2][amount]).toBe('B4*C4');
  });
});
