// Dedupe, computed columns and row filters against desktop Excel, row by row. Excel ran
// Remove Duplicates, =a+b / =a-b / =a*b / =a/b and AutoFilter on the generated edge-case
// files (scripts/gen-dedupe-cases.cjs, scripts/gen-ops-cases.cjs) via
// scripts/excel-dedupe-reference.ps1 and scripts/excel-ops-reference.ps1.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SheetData } from '../types';
import { parseFileBytes } from './import';
import { addComputedColumn, filterRows, joinSheets, removeDuplicates, unionSheets, type FilterOperator } from './dataProcessService';

const ROOT = join(__dirname, '../..');
const load = (rel: string): SheetData =>
  parseFileBytes(rel, new Uint8Array(readFileSync(join(ROOT, rel)))).file.sheets[0];
const json = <T>(rel: string): T => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T;
const ids = (s: SheetData): number[] => s.rows.map((r) => Number(r[0]));
const list = (v: number[] | number): number[] => (Array.isArray(v) ? v : [v]);

describe('dedupe equals Excel Remove Duplicates', () => {
  const sheet = load('sample-data/edge-cases/dedupe_variants.csv');
  it.each([
    ['all', ['value', 'tag']],
    ['value', ['value']],
  ])('on %s columns', (file, keys) => {
    const want = json<{ kept: number[] }>(`sample-data/excel-reference/dedupe_variants.${file}.json`).kept;
    expect(ids(removeDuplicates(sheet, keys).result)).toEqual(want);
  });
});

describe('computed column equals the Excel formula', () => {
  const sheet = load('sample-data/edge-cases/ops_variants.csv');
  const ref = json<{ calc: Record<'add' | 'sub' | 'mul' | 'div', string>[] }>('sample-data/excel-reference/ops_variants.json');
  it.each([
    ['add', '+'],
    ['sub', '-'],
    ['mul', '*'],
    ['div', '/'],
  ] as const)('=a%sb', (key, op) => {
    const out = addComputedColumn(sheet, { name: 'x', type: 'calc', colA: 'a', colB: 'b', operator: op });
    const problems: string[] = [];
    out.rows.forEach((r, i) => {
      const want = ref.calc[i][key];
      const got = r[r.length - 1];
      // Same double unless both are numbers that differ only by float noise.
      const close = want === got || (want !== '' && Math.abs(Number(want) - Number(got)) <= 1e-12 * Math.max(1, Math.abs(Number(want))));
      if (!close) problems.push(`${JSON.stringify(sheet.rows[i][1])}${op}${JSON.stringify(sheet.rows[i][2])}: excel=${want} ours=${got}`);
    });
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it('keeps every source cell untouched', () => {
    const before = JSON.stringify(sheet.rows);
    addComputedColumn(sheet, { name: 'x', type: 'calc', colA: 'a', colB: 'b', operator: '/' });
    expect(JSON.stringify(sheet.rows)).toBe(before);
  });
});

describe('row filter equals Excel AutoFilter', () => {
  const sheet = load('sample-data/edge-cases/ops_variants.csv');
  const ref = json<{ filters: { name: string; kept: number[] | number }[] }>('sample-data/excel-reference/ops_variants.json');
  const cases = json<{ name: string; column: string; op: FilterOperator; value: string }[]>('sample-data/excel-reference/ops_filters.json');
  // Deliberately wider than Excel: "contains" also searches numbers (Excel's text filter
  // skips number cells, so "contains 1" would miss 1000), and error values are text.
  const WIDER = new Set(['a_contains_1', 'a_not_contains_a']);
  for (const c of cases.filter((x) => !WIDER.has(x.name))) {
    it(c.name, () => {
      const want = list(ref.filters.find((f) => f.name === c.name)?.kept ?? []);
      const got = ids(filterRows(sheet, [{ id: '1', column: c.column, operator: c.op, value: c.value }]).result);
      expect(got).toEqual(want);
    });
  }
  it('contains searches numbers as their text, too', () => {
    const got = filterRows(sheet, [{ id: '1', column: 'a', operator: 'contains', value: '1' }]).result.rows.map((r) => r[1]);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((v) => v.includes('1'))).toBe(true);
    expect(got).toContain('1000');
  });
});

describe('merge keeps Excel display text with its cell', () => {
  const a: SheetData = { name: 'a', headers: ['id', 'amt'], rows: [['1', '0.5'], ['2', '3']], display: [[null, '50%'], [null, '$3.00']] };
  const b: SheetData = { name: 'b', headers: ['amt', 'id', 'note'], rows: [['7', '2', 'x'], ['8', '1', 'y']], display: [['7.0', null, null], [null, null, 'Y!']] };
  it('join', () => {
    const { result } = joinSheets(a, b, 'id', 'id');
    expect(result.rows).toEqual([['1', '0.5', '8', 'y'], ['2', '3', '7', 'x']]);
    expect(result.display).toEqual([[null, '50%', null, 'Y!'], [null, '$3.00', '7.0', null]]);
  });
  it('union aligns display by header', () => {
    const out = unionSheets(a, b);
    expect(out.headers).toEqual(['id', 'amt', 'note']);
    expect(out.rows).toEqual([['1', '0.5', ''], ['2', '3', ''], ['2', '7', 'x'], ['1', '8', 'y']]);
    expect(out.display).toEqual([[null, '50%', null], [null, '$3.00', null], [null, '7.0', null], [null, null, 'Y!']]);
  });
});
