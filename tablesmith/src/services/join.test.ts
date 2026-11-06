// Join (VLOOKUP-style) on real data: sales_detail.csv joined to business_units.csv by
// business_unit_id. Checked against an independent lookup built from the raw CSV text,
// plus the number-key and duplicate-key rules.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SheetData } from '../types';
import { parseFileBytes } from './import';
import { joinKey, joinSheets } from './dataProcessService';

const SALES = 'D:/tmp/excel/sales_detail.csv';
const UNITS = 'D:/tmp/excel/business_units.csv';
const have = existsSync(SALES) && existsSync(UNITS);

function load(path: string): SheetData {
  return parseFileBytes(path.split('/').pop() ?? path, new Uint8Array(readFileSync(path))).file.sheets[0];
}

/** Oracle: plain split of the raw CSV (these files have no quoted commas). */
function rawCsv(path: string): { headers: string[]; rows: string[][] } {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  return { headers: lines[0].split(','), rows: lines.slice(1).map((l) => l.split(',')) };
}

describe('joinKey', () => {
  it.each([
    ['199', '199.00', true],
    [' 42 ', '42', true],
    ['-0.5', '-.5', true],
    ['00892', '892', true],
    ['BU-CLOUD', 'bu-cloud', false],
    ['1,200', '1200', false],
    ['', '0', false],
  ])('%j matches %j: %s', (a, b, want) => expect(joinKey(a) === joinKey(b)).toBe(want));
});

describe.skipIf(!have)('join on real files', () => {
  const sales = have ? load(SALES) : null!;
  const units = have ? load(UNITS) : null!;

  it('every sales row gets its business unit, checked against the raw CSV', () => {
    const { result, stats } = joinSheets(sales, units, 'business_unit_id', 'business_unit_id', 'left');
    expect(stats.matched).toBe(sales.rows.length);
    expect(stats.unmatched).toBe(0);
    expect(stats.duplicateKeys).toEqual([]);
    expect(result.rows).toHaveLength(sales.rows.length);

    const raw = rawCsv(UNITS);
    const nameOf = new Map(raw.rows.map((r) => [r[raw.headers.indexOf('business_unit_id')], r[raw.headers.indexOf('business_unit_name')]]));
    const bu = result.headers.indexOf('business_unit_id');
    const name = result.headers.indexOf('business_unit_name');
    expect(name).toBeGreaterThan(0);
    for (const row of result.rows) expect(row[name]).toBe(nameOf.get(row[bu]));
    // A column present in both tables is kept twice, the second one renamed.
    expect(result.headers).toContain(`entity_id_(${units.name})`);
  });

  it('left keeps unmatched rows empty, inner drops them, and both count them', () => {
    const partial: SheetData = { ...units, rows: units.rows.slice(0, 2) };
    const kept = new Set(partial.rows.map((r) => r[units.headers.indexOf('business_unit_id')]));
    const expectedMatched = sales.rows.filter((r) => kept.has(r[sales.headers.indexOf('business_unit_id')])).length;
    expect(expectedMatched).toBeGreaterThan(0);
    expect(expectedMatched).toBeLessThan(sales.rows.length);

    const left = joinSheets(sales, partial, 'business_unit_id', 'business_unit_id', 'left');
    expect(left.stats).toMatchObject({ matched: expectedMatched, unmatched: sales.rows.length - expectedMatched });
    expect(left.result.rows).toHaveLength(sales.rows.length);
    const name = left.result.headers.indexOf('business_unit_name');
    expect(left.result.rows.filter((r) => r[name] === '')).toHaveLength(sales.rows.length - expectedMatched);

    const inner = joinSheets(sales, partial, 'business_unit_id', 'business_unit_id', 'inner');
    expect(inner.result.rows).toHaveLength(expectedMatched);
    expect(inner.stats.unmatched).toBe(sales.rows.length - expectedMatched);
  });

  it('a key repeated in the lookup table is reported, and the first match is used', () => {
    const buCol = units.headers.indexOf('business_unit_id');
    const nameCol = units.headers.indexOf('business_unit_name');
    const dupId = units.rows[0][buCol];
    const extra = units.rows[0].map((v, c) => (c === nameCol ? `${v}（重复）` : v));
    const withDup: SheetData = { ...units, rows: [...units.rows, extra] };
    const { result, stats } = joinSheets(sales, withDup, 'business_unit_id', 'business_unit_id', 'left');
    expect(stats.duplicateKeys).toEqual([{ key: dupId, count: 2 }]);
    const name = result.headers.indexOf('business_unit_name');
    const bu = result.headers.indexOf('business_unit_id');
    for (const row of result.rows) if (row[bu] === dupId) expect(row[name]).toBe(units.rows[0][nameCol]);
  });

  it('number keys match across files that write them differently', () => {
    const a: SheetData = { name: 'a', headers: ['account', 'amount'], rows: [['4000', '10'], ['5100', '20'], ['6100', '30']] };
    const b: SheetData = { name: 'b', headers: ['account', 'label'], rows: [['4000.00', 'Payroll'], ['5100.0', 'COGS'], ['00610', 'Wrong']] };
    const { result, stats } = joinSheets(a, b, 'account', 'account', 'left');
    expect(stats).toMatchObject({ matched: 2, unmatched: 1 });
    expect(result.rows.map((r) => r[2])).toEqual(['Payroll', 'COGS', '']);
  });

  it('does not change either input', () => {
    const s = JSON.stringify(sales);
    const u = JSON.stringify(units);
    joinSheets(sales, units, 'business_unit_id', 'business_unit_id', 'inner');
    expect(JSON.stringify(sales)).toBe(s);
    expect(JSON.stringify(units)).toBe(u);
  });
});
