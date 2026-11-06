// Cell-by-cell comparison of formatNumber against real desktop Excel (zh-CN). The
// references come from scripts/excel-reference.ps1; see docs/display-formats.md.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_FORMATS_ZH_CN, formatNumber } from './numberFormat';

type RefCell = [row: number, col: number, value: string, format: string, text: string];
interface Ref {
  sheets: { name: string; cells: RefCell[] }[];
}

const REF_DIR = join(__dirname, '../../../sample-data/excel-reference');
const FULL_REF = join(__dirname, '../../../src-tauri/target/excel-reference/Financial_BP_Rolling_Forecast.xlsx.json');

function load(name: string): Ref {
  return JSON.parse(readFileSync(join(REF_DIR, name), 'utf8')) as Ref;
}

/** Excel pads with spaces for column alignment; compare the visible text. */
const visible = (t: string) => t.replace(/\s+/g, ' ').trim();

function mismatches(ref: Ref, codeFor: (cell: RefCell) => string): string[] {
  const out: string[] = [];
  for (const sheet of ref.sheets) {
    for (const cell of sheet.cells) {
      const [, , value, , text] = cell;
      const n = Number(value);
      if (value === '' || Number.isNaN(n) || /^#+$/.test(text)) continue;
      // Under `@` the reference values are text cells ("00892"); text rendering is
      // covered by display.test.ts, which knows each cell's real type.
      if (cell[3] === '@') continue;
      const code = codeFor(cell);
      const ours = formatNumber(n, code) ?? null;
      const expected = visible(text);
      // null means "show the raw value"; Excel's General rendering is checked separately.
      if (ours === null) continue;
      if (ours !== expected) out.push(`${JSON.stringify(code)} ${value}: excel=${JSON.stringify(expected)} ours=${JSON.stringify(ours)}`);
    }
  }
  return out;
}

describe('formatNumber vs desktop Excel', () => {
  it('matches every cell of number_formats.xlsx', () => {
    expect(mismatches(load('number_formats.xlsx.json'), (c) => c[3])).toEqual([]);
  });

  it('matches every built-in format id', () => {
    const ref = load('builtin_format_ids.xlsx.json');
    const ids = new Map<number, number>();
    for (const [r, c, value] of ref.sheets[0].cells) if (c === 0) ids.set(r, Number(value));
    const diffs = mismatches(ref, ([r, c]) => (c === 0 ? 'General' : BUILTIN_FORMATS_ZH_CN[ids.get(r) ?? 0]));
    expect(diffs).toEqual([]);
  });

  it.skipIf(!existsSync(FULL_REF))('matches all numeric cells of the financial model', () => {
    const ref = JSON.parse(readFileSync(FULL_REF, 'utf8').replace(/^﻿/, '')) as {
      sheets: { name: string; cells: { r: number; c: number; value: string; format: string; text: string }[] }[];
    };
    const compact: Ref = {
      sheets: ref.sheets.map((s) => ({ name: s.name, cells: s.cells.map((c) => [c.r, c.c, c.value, c.format, c.text] as RefCell) })),
    };
    expect(mismatches(compact, (c) => c[3])).toEqual([]);
  });

  it('returns null for General so the raw value is shown', () => {
    expect(formatNumber(0.1 + 0.2, 'General')).toBeNull();
    expect(formatNumber(5, 'G/通用格式')).toBeNull();
  });
});
