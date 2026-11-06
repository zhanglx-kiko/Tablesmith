// Pivot results against desktop Excel's own PivotTable engine, cell by cell. Excel built
// each pivot in sample-data/excel-reference/pivot_cases.json from the real
// sales_detail.csv (scripts/excel-pivot-reference.ps1); the dump lives under the ignored
// src-tauri/target/excel-reference/ because the data is the user's file.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SheetData } from '../types';
import { parseFileBytes } from './import';
import { generatePivotTable, generatePivotTableWithMeta, pivotCellDetail, type PivotAggType, type PivotConfig } from './pivotTableService';

const CSV = 'D:/tmp/excel/sales_detail.csv';
const REF = join(__dirname, '../../src-tauri/target/excel-reference/pivot_sales.json');
const CASES = join(__dirname, '../../sample-data/excel-reference/pivot_cases.json');
const DETAIL = join(__dirname, '../../src-tauri/target/excel-reference/pivot_detail_sales.json');
const have = existsSync(CSV) && existsSync(REF);

interface Case {
  name: string;
  rows: string[];
  cols: string[];
  value: string;
  agg: 'sum' | 'count' | 'average' | 'max' | 'min';
  filter?: { field: string; item: string };
}

const AGG: Record<Case['agg'], PivotAggType> = { sum: 'sum', count: 'count', average: 'avg', max: 'max', min: 'min' };
const GRAND = new Set(['总计', 'Grand Total']);

/**
 * Excel opens "2024-01" in a CSV as a date (serial 45292). Map such labels back to the
 * text the CSV holds so keys compare.
 */
function label(field: string, v: string): string {
  if (field === 'period_id' && /^\d{5}$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(v) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return v;
}

/** Excel grid -> "rowKey|colKey" -> value; totals keyed with "*". */
function excelCells(c: Case, grid: string[][]): Map<string, string> {
  const out = new Map<string, string>();
  const nRow = c.rows.length;
  const hasCols = c.cols.length > 0;
  const head = hasCols ? grid[1] : grid[0];
  const colKeys = hasCols ? head.slice(nRow).map((k) => (GRAND.has(k) ? '*' : label(c.cols[0], k))) : ['V'];
  for (const row of grid.slice(hasCols ? 2 : 1)) {
    const grand = GRAND.has(row[0]);
    const rk = grand ? '*' : row.slice(0, nRow).map((v, i) => label(c.rows[i], v)).join('/');
    row.slice(nRow).forEach((v, i) => {
      if (v !== '') out.set(`${rk}|${colKeys[i]}`, v);
    });
  }
  return out;
}

/** Our pivot -> same keys. */
function ourCells(c: Case, sheet: SheetData): Map<string, string> {
  const out = new Map<string, string>();
  const nRow = c.rows.length;
  const hasCols = c.cols.length > 0;
  const colKeys = sheet.headers.slice(nRow).map((h) => (h === '总计' ? '*' : hasCols ? h : 'V'));
  for (const row of sheet.rows) {
    const grand = row[0] === '总计';
    const rk = grand ? '*' : row.slice(0, nRow).join('/');
    row.slice(nRow).forEach((v, i) => {
      if (v !== '') out.set(`${rk}|${colKeys[i]}`, v);
    });
  }
  return out;
}

function config(c: Case): PivotConfig {
  return {
    rowField: c.rows[0],
    subRowField: c.rows[1],
    colField: c.cols[0],
    valueField: c.value,
    aggType: AGG[c.agg],
    filterField: c.filter?.field,
    filterValue: c.filter?.item,
    showRowTotal: true,
    showColTotal: true,
  };
}

describe.skipIf(!have)('pivot equals desktop Excel PivotTable, cell by cell', () => {
  const sheet = have ? parseFileBytes('sales_detail.csv', new Uint8Array(readFileSync(CSV))).file.sheets[0] : null!;
  const cases = JSON.parse(readFileSync(CASES, 'utf8')) as Case[];
  const ref = have ? (JSON.parse(readFileSync(REF, 'utf8').replace(/^\uFEFF/, '')) as { name: string; grid: string[][] }[]) : [];

  for (const c of cases) {
    it(c.name, () => {
      const grid = ref.find((r) => r.name === c.name)?.grid;
      expect(grid, 'reference missing').toBeDefined();
      const want = excelCells(c, grid ?? []);
      const got = ourCells(c, generatePivotTable(sheet, config(c)));
      const problems: string[] = [];
      for (const [k, v] of want) {
        const ours = got.get(k);
        // Same double: Excel and we both sum in data order; allow only float noise.
        const a = Number(v);
        const b = Number(ours);
        const close = ours !== undefined && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
        if (!close) problems.push(`${k}: excel=${v} ours=${ours}`);
      }
      for (const k of got.keys()) if (!want.has(k)) problems.push(`${k}: extra ours=${got.get(k)}`);
      expect(want.size).toBeGreaterThan(3);
      expect(problems.slice(0, 10)).toEqual([]);
    });
  }
});

describe('pivot value modes and blanks', () => {
  const sheet: SheetData = {
    name: 's',
    headers: ['r', 'c', 'v'],
    rows: [
      ['A', 'x', '10'],
      ['A', 'y', '30'],
      ['B', 'x', '60'],
      ['B', 'x', ''],
      ['C', 'y', 'n/a'],
    ],
  };
  const base: PivotConfig = { rowField: 'r', colField: 'c', valueField: 'v', aggType: 'sum' };

  it('percent of total keeps the exact fraction as raw and shows a percent', () => {
    const out = generatePivotTable(sheet, { ...base, valueMode: 'percent_total' });
    expect(out.headers).toEqual(['r', 'x', 'y', '总计']);
    expect(out.rows[0]).toEqual(['A', String(10 / 100), String(30 / 100), String(40 / 100)]);
    expect(out.display?.[0]).toEqual([null, '10.00%', '30.00%', '40.00%']);
    expect(out.rows[out.rows.length - 1]).toEqual(['总计', String(70 / 100), String(30 / 100), '1']);
  });

  it('percent of row sums each row to 1', () => {
    const out = generatePivotTable(sheet, { ...base, valueMode: 'percent_row' });
    expect(out.rows[0].slice(1)).toEqual([String(0.25), String(0.75), '1']);
  });

  it('a cell with no source rows is blank; text-only values sum to 0 like Excel', () => {
    const out = generatePivotTable(sheet, base);
    const b = out.rows.find((r) => r[0] === 'B')!;
    const c = out.rows.find((r) => r[0] === 'C')!;
    expect(b).toEqual(['B', '60', '', '60']);
    expect(c).toEqual(['C', '', '0', '0']);
  });

  it('average skips blanks and text, and is not rounded', () => {
    const out = generatePivotTable({ ...sheet, rows: [...sheet.rows, ['A', 'x', '1']] }, { ...base, aggType: 'avg' });
    expect(out.rows[0][1]).toBe(String(11 / 2));
    expect(out.rows[out.rows.length - 1]![3]).toBe(String(101 / 4));
  });

  it('pivot never touches the source sheet', () => {
    const before = JSON.stringify(sheet);
    generatePivotTable(sheet, { ...base, valueMode: 'percent_col' });
    expect(JSON.stringify(sheet)).toBe(before);
  });
});

/**
 * Drill-down against Excel's Show Details: scripts/excel-pivot-detail.ps1 double-clicked
 * every value cell of the same pivots and recorded the sale_ids Excel listed.
 */
describe.skipIf(!have || !existsSync(DETAIL))('drill-down equals Excel Show Details, row by row', () => {
  const sheet = have ? parseFileBytes('sales_detail.csv', new Uint8Array(readFileSync(CSV))).file.sheets[0] : null!;
  const cases = JSON.parse(readFileSync(CASES, 'utf8')) as Case[];
  const ref = have ? (JSON.parse(readFileSync(REF, 'utf8').replace(/^﻿/, '')) as { name: string; grid: string[][] }[]) : [];
  const detail = existsSync(DETAIL)
    ? (JSON.parse(readFileSync(DETAIL, 'utf8').replace(/^﻿/, '')) as { name: string; cells: { r: number; c: number; ids: string[] | string }[] }[])
    : [];

  for (const c of cases) {
    it(c.name, () => {
      const grid = ref.find((r) => r.name === c.name)!.grid;
      const cells = detail.find((d) => d.name === c.name)!.cells;
      const cfg = config(c);
      const out = generatePivotTableWithMeta(sheet, cfg);
      const nRow = c.rows.length;
      const hasCols = c.cols.length > 0;
      const head = hasCols ? grid[1] : grid[0];
      const problems: string[] = [];
      let compared = 0;
      for (const cell of cells) {
        const want = ([] as string[]).concat(cell.ids).sort();
        if (want.length === 0) continue;
        // Excel cell -> our cell through the row labels and the column header.
        const line = grid[cell.r];
        const grand = GRAND.has(line[0]);
        const rk = line.slice(0, nRow).map((v, i) => label(c.rows[i], v)).join('/');
        const ourRow = out.sheet.rows.findIndex((r) => (grand ? r[0] === '总计' : r.slice(0, nRow).join('/') === rk));
        const colHead = head[cell.c];
        const ourCol = !hasCols ? nRow : GRAND.has(colHead) ? out.sheet.headers.indexOf('总计') : out.sheet.headers.indexOf(label(c.cols[0], colHead));
        const got = pivotCellDetail(sheet, cfg, ourRow, ourCol);
        const ids = (got?.sheet.rows.map((r) => r[0]) ?? []).sort();
        compared += 1;
        if (ids.length !== want.length || ids.some((id, i) => id !== want[i])) {
          problems.push(`${rk}|${colHead}: excel ${want.length} rows, ours ${ids.length}`);
        }
      }
      expect(compared).toBeGreaterThan(3);
      expect(problems.slice(0, 10)).toEqual([]);
    });
  }
});

describe('pivot drill-down', () => {
  const sheet: SheetData = {
    name: 's',
    headers: ['r', 'c', 'v', 'k'],
    rows: [
      ['A', 'x', '10', 'p'],
      ['A', 'y', '30', 'q'],
      ['B', 'x', '60', 'p'],
      ['B', 'x', '', 'q'],
      ['C', 'y', 'n/a', 'p'],
      ['A', 'x', '5', 'q'],
    ],
    display: [
      ['A', 'x', '10.00', 'p'],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ],
    formulas: [[null, null, 'B1*2', null], [], [], [], [], []],
  };
  const base: PivotConfig = { rowField: 'r', colField: 'c', valueField: 'v', aggType: 'sum' };
  const rowsOf = (cfg: PivotConfig, r: number, c: number) => pivotCellDetail(sheet, cfg, r, c)?.sheet.rows ?? null;

  it('a value cell lists every source row of its group, blanks and text included', () => {
    // Output: A, B, C, 总计; columns r, x, y, 总计.
    expect(rowsOf(base, 0, 1)).toEqual([sheet.rows[0], sheet.rows[5]]);
    expect(rowsOf(base, 1, 1)).toEqual([sheet.rows[2], sheet.rows[3]]);
    expect(rowsOf(base, 2, 2)).toEqual([sheet.rows[4]]);
  });

  it('totals list their whole row, column or table in source order', () => {
    expect(rowsOf(base, 0, 3)).toEqual([sheet.rows[0], sheet.rows[1], sheet.rows[5]]);
    expect(rowsOf(base, 3, 1)).toEqual([sheet.rows[0], sheet.rows[2], sheet.rows[3], sheet.rows[5]]);
    expect(rowsOf(base, 3, 3)).toEqual(sheet.rows);
  });

  it('label cells and empty cells have no detail', () => {
    expect(pivotCellDetail(sheet, base, 0, 0)).toBeNull();
    expect(pivotCellDetail(sheet, base, 2, 1)).toBeNull();
  });

  it('the report filter limits the detail, and the label names the cell', () => {
    const cfg: PivotConfig = { ...base, filterField: 'k', filterValue: 'p' };
    const d = pivotCellDetail(sheet, cfg, 0, 1)!;
    expect(d.sheet.rows).toEqual([sheet.rows[0]]);
    expect(d.label).toBe('r=A · c=x · k=p');
    expect(pivotCellDetail(sheet, cfg, 3, 3)!.label).toBe('总计 · k=p');
    expect(pivotCellDetail(sheet, cfg, 3, 3)!.sheet.rows).toEqual([sheet.rows[0], sheet.rows[2], sheet.rows[4]]);
  });

  it('two row levels and value modes drill the same way', () => {
    const cfg: PivotConfig = { rowField: 'r', subRowField: 'k', valueField: 'v', aggType: 'count', valueMode: 'percent_total' };
    const out = generatePivotTableWithMeta(sheet, cfg);
    const aq = out.sheet.rows.findIndex((r) => r[0] === 'A' && r[1] === 'q');
    const d = pivotCellDetail(sheet, cfg, aq, 2)!;
    expect(d.sheet.rows).toEqual([sheet.rows[1], sheet.rows[5]]);
    expect(d.label).toBe('r=A · k=q');
  });

  it('detail rows keep their display text and formulas, and the source is unchanged', () => {
    const before = JSON.stringify(sheet);
    const d = pivotCellDetail(sheet, base, 0, 1)!;
    expect(d.sheet.headers).toEqual(sheet.headers);
    expect(d.sheet.display?.[0]).toEqual(sheet.display?.[0]);
    expect(d.sheet.formulas?.[0]).toEqual(sheet.formulas?.[0]);
    expect(JSON.stringify(sheet)).toBe(before);
  });
});
