// Processing-step recording and replay. A recipe is recorded on the Sales Detail sheet of
// the real financial model and replayed on sales_detail.csv: same columns, same numbers,
// different text (199 vs 199.00 in 30,710 cells), the way next month's export differs
// from this month's workbook.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SheetData } from '../types';
import { parseFileBytes } from './import';
import {
  addComputedColumn,
  deleteColumns,
  filterRows,
  maskColumnData,
  removeDuplicates,
  trimWhitespace,
} from './dataProcessService';
import { generatePivotTable } from './pivotTableService';
import {
  RecipeError,
  describeStep,
  missingColumns,
  parseRecipe,
  runRecipe,
  serializeRecipe,
  type Recipe,
  type RecipeStep,
} from './recipeService';

const MODEL = 'D:/tmp/excel/Financial_BP_Rolling_Forecast.xlsx';
const CSV = 'D:/tmp/excel/sales_detail.csv';
const have = existsSync(MODEL) && existsSync(CSV);

function load(path: string, sheet?: string): SheetData {
  const sheets = parseFileBytes(path.split('/').pop() ?? path, new Uint8Array(readFileSync(path))).file.sheets;
  const s = sheet ? sheets.find((x) => x.name === sheet) : sheets[0];
  if (!s) throw new Error(`no sheet ${sheet}`);
  return s;
}

/** Numbers compare by value (199 == 199.00), text exactly. */
function sameValue(a: string, b: string): boolean {
  if (a === b) return true;
  const na = Number(a);
  const nb = Number(b);
  return a.trim() !== '' && b.trim() !== '' && Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) <= 1e-9 * Math.max(1, Math.abs(na));
}

function diff(a: SheetData, b: SheetData): string[] {
  const out: string[] = [];
  if (JSON.stringify(a.headers) !== JSON.stringify(b.headers)) out.push(`headers ${a.headers.join(',')} vs ${b.headers.join(',')}`);
  if (a.rows.length !== b.rows.length) out.push(`rows ${a.rows.length} vs ${b.rows.length}`);
  a.rows.forEach((row, r) =>
    row.forEach((v, c) => {
      const w = b.rows[r]?.[c] ?? '';
      if (!sameValue(v, w)) out.push(`R${r}C${c} ${JSON.stringify(v)} vs ${JSON.stringify(w)}`);
    }),
  );
  return out.slice(0, 8);
}

// A month-end cleanup a finance user would record.
const STEPS: RecipeStep[] = [
  { op: 'trim' },
  {
    op: 'filter',
    match: 'all',
    conditions: [
      { column: 'region', operator: 'equals', value: 'Northeast' },
      { column: 'units', operator: 'greaterThan', value: '50' },
    ],
  },
  { op: 'compute', config: { name: 'gross_margin_usd', type: 'calc', colA: 'net_revenue_usd', colB: 'cogs_usd', operator: '-' } },
  { op: 'dedupe', columns: ['sale_id'] },
  { op: 'deleteColumns', columns: ['currency_code', 'list_price_usd'] },
  { op: 'mask', column: 'customer_id', type: 'all' },
];
const PIVOT: RecipeStep = {
  op: 'pivot',
  config: { rowField: 'product_id', colField: 'period_id', valueField: 'gross_margin_usd', aggType: 'sum', showRowTotal: true, showColTotal: true },
};

describe.skipIf(!have)('recipe replay on real data', () => {
  const xlsx = have ? load(MODEL, 'Sales Detail') : null!;
  const csv = have ? load(CSV) : null!;

  it('the two sources really are the same data written differently', () => {
    expect(csv.headers).toEqual(xlsx.headers);
    expect(csv.rows.length).toBe(xlsx.rows.length);
    expect(diff(xlsx, csv)).toEqual([]); // equal as values
    const textDiffs = xlsx.rows.reduce((n, row, r) => n + row.filter((v, c) => v !== csv.rows[r][c]).length, 0);
    expect(textDiffs).toBeGreaterThan(10_000); // but not as text
  });

  it('replay equals applying the same operations by hand, step by step', () => {
    let manual = trimWhitespace(xlsx);
    manual = filterRows(manual, [
      { id: 'a', column: 'region', operator: 'equals', value: 'Northeast' },
      { id: 'b', column: 'units', operator: 'greaterThan', value: '50' },
    ], 'all').result;
    manual = addComputedColumn(manual, { name: 'gross_margin_usd', type: 'calc', colA: 'net_revenue_usd', colB: 'cogs_usd', operator: '-' });
    manual = removeDuplicates(manual, ['sale_id']).result;
    manual = deleteColumns(manual, ['currency_code', 'list_price_usd']);
    manual = maskColumnData(manual, 'customer_id', 'all').result;
    const { result, log } = runRecipe(xlsx, STEPS);
    expect(result).toEqual(manual);
    expect(log.map((l) => l.rowsAfter)).toEqual(log.map((_, i) => (i + 1 < log.length ? log[i + 1].rowsBefore : result.rows.length)));
    // The filter really dropped rows and the recipe kept the computed column.
    expect(result.rows.length).toBeGreaterThan(100);
    expect(result.rows.length).toBeLessThan(xlsx.rows.length / 2);
    expect(result.headers).toContain('gross_margin_usd');
    expect(result.headers).not.toContain('currency_code');
  });

  it('recorded on the workbook, replayed on the CSV: identical rows and values', () => {
    const a = runRecipe(xlsx, STEPS).result;
    const b = runRecipe(csv, STEPS).result;
    expect(diff(a, b)).toEqual([]);
    // Every computed margin equals net - cogs of the same source row.
    const ni = a.headers.indexOf('net_revenue_usd');
    const ci = a.headers.indexOf('cogs_usd');
    const mi = a.headers.indexOf('gross_margin_usd');
    for (const row of b.rows) expect(Number(row[mi])).toBeCloseTo(Number(row[ni]) - Number(row[ci]), 6);
    // Masking hides every customer id in both.
    const cu = a.headers.indexOf('customer_id');
    expect(b.rows.every((r) => !/CUS-\d{4}/.test(r[cu]))).toBe(true);
  });

  it('pivot after the cleanup gives the same totals on both sources', () => {
    const a = runRecipe(xlsx, [...STEPS, PIVOT]).result;
    const b = runRecipe(csv, [...STEPS, PIVOT]).result;
    expect(diff(a, b)).toEqual([]);
    expect(a.headers.length).toBeGreaterThan(5);
    // Pivot of the replayed data equals pivoting the cleaned sheet directly.
    const cleaned = runRecipe(csv, STEPS).result;
    expect(diff(b, generatePivotTable(cleaned, PIVOT.op === 'pivot' ? PIVOT.config : (null as never)))).toEqual([]);
  });

  it('does not modify the input sheet', () => {
    const before = JSON.stringify(csv);
    runRecipe(csv, [...STEPS, PIVOT]);
    expect(JSON.stringify(csv)).toBe(before);
  });

  it('a saved recipe file replays to the same result', () => {
    const recipe: Recipe = { version: 1, name: '月末清洗', sourceHeaders: xlsx.headers, steps: [...STEPS, PIVOT] };
    const text = serializeRecipe(recipe);
    const parsed = parseRecipe(text);
    expect(parsed).toEqual(recipe);
    expect(runRecipe(csv, parsed.steps).result).toEqual(runRecipe(csv, recipe.steps).result);
  });

  it('stops before changing anything when a column is missing, naming the step', () => {
    const renamed: SheetData = { ...csv, headers: csv.headers.map((h) => (h === 'cogs_usd' ? 'cost_usd' : h)) };
    expect(() => runRecipe(renamed, STEPS)).toThrow(RecipeError);
    try {
      runRecipe(renamed, STEPS);
    } catch (e) {
      expect(e).toBeInstanceOf(RecipeError);
      expect((e as RecipeError).stepIndex).toBe(2);
      expect((e as Error).message).toContain('「cogs_usd」');
      expect((e as Error).message).toContain('第 3 步');
    }
    expect(missingColumns(renamed.headers, STEPS)).toEqual([{ stepIndex: 2, columns: ['cogs_usd'] }]);
  });
});

describe('recipe column bookkeeping', () => {
  it('a computed column can be used by later steps, a deleted one cannot', () => {
    const headers = ['a', 'b'];
    const steps: RecipeStep[] = [
      { op: 'compute', config: { name: 'c', type: 'calc', colA: 'a', colB: 'b', operator: '+' } },
      { op: 'filter', match: 'all', conditions: [{ column: 'c', operator: 'greaterThan', value: '1' }] },
      { op: 'deleteColumns', columns: ['a'] },
      { op: 'dedupe', columns: ['a'] },
    ];
    expect(missingColumns(headers, steps)).toEqual([{ stepIndex: 3, columns: ['a'] }]);
  });

  it('every step has a readable description', () => {
    for (const step of [...STEPS, PIVOT, { op: 'removeEmptyRows' } as const, { op: 'dedupe' } as const]) {
      const text = describeStep(step);
      expect(text.length).toBeGreaterThan(3);
      expect(text).not.toMatch(/undefined|\[object/);
    }
    expect(describeStep(STEPS[1])).toBe('筛选：「region」等于 Northeast 且 「units」大于 50');
  });
});

describe('recipe files', () => {
  it.each([
    ['not json', '{', 'JSON 格式错误'],
    ['other json', '{"a":1}', '版本不受支持'],
    ['wrong version', '{"version":2,"steps":[]}', '版本不受支持'],
    ['unknown step', '{"version":1,"steps":[{"op":"format_disk"}]}', '第 1 步'],
    ['bad mask type', '{"version":1,"steps":[{"op":"mask","column":"x","type":"rot13"}]}', '第 1 步'],
    ['bad filter operator', '{"version":1,"steps":[{"op":"filter","match":"all","conditions":[{"column":"x","operator":"like","value":"1"}]}]}', '第 1 步'],
    ['columns not strings', '{"version":1,"steps":[{"op":"trim"},{"op":"deleteColumns","columns":[1]}]}', '第 2 步'],
  ])('%s is rejected with a clear message', (_, text, message) => {
    expect(() => parseRecipe(text)).toThrow(RecipeError);
    expect(() => parseRecipe(text)).toThrow(message);
  });
});
