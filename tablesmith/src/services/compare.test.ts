// Cross-file compare, tested on real data with known edits. The "new" table is the real
// sales_detail.csv; the "old" table is the same data from the workbook's Sales Detail
// sheet (numbers written 199 vs 199.00) with planted edits: rows removed, rows added,
// cells changed, a duplicated key, an empty key, and the row order shuffled. Every
// planted edit must be reported exactly, and nothing else.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SheetData } from '../types';
import { parseFileBytes } from './import';
import { CompareError, compareSheets, compareToSheet, sameCell } from './compareService';

const MODEL = 'D:/tmp/excel/Financial_BP_Rolling_Forecast.xlsx';
const CSV = 'D:/tmp/excel/sales_detail.csv';
const have = existsSync(MODEL) && existsSync(CSV);

function load(path: string, sheet?: string): SheetData {
  const sheets = parseFileBytes(path.split('/').pop() ?? path, new Uint8Array(readFileSync(path))).file.sheets;
  const s = sheet ? sheets.find((x) => x.name === sheet) : sheets[0];
  if (!s) throw new Error(`no sheet ${sheet}`);
  return s;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('sameCell', () => {
  const o = { keys: ['k'] };
  it.each([
    ['199', '199.00', true],
    ['0.05', '0.0500', true],
    ['-0', '0', true],
    ['1,200', '1200', false], // formatted text is a text difference
    ['00892', '892', true], // as plain numbers they are equal...
    ['abc', 'ABC', false],
    [' a', 'a', false],
    ['', '0', false],
  ])('%j vs %j -> %s', (a, b, want) => expect(sameCell(a, b, o)).toBe(want));

  it('options loosen text comparison only when asked', () => {
    expect(sameCell(' a', 'a', { keys: ['k'], ignoreWhitespace: true })).toBe(true);
    expect(sameCell('abc', 'ABC', { keys: ['k'], ignoreCase: true })).toBe(true);
    expect(sameCell('199', '199.00', { keys: ['k'], numericByValue: false })).toBe(false);
  });
});

describe('compareSheets input checks', () => {
  const t: SheetData = { name: 't', headers: ['id', 'v'], rows: [['1', 'a']] };
  it('needs at least one key', () => expect(() => compareSheets(t, t, { keys: [] })).toThrow(CompareError));
  it('names the missing key column and the table', () => {
    const other: SheetData = { name: 'o', headers: ['code', 'v'], rows: [] };
    expect(() => compareSheets(t, other, { keys: ['id'] })).toThrow('新表没有「id」');
  });
});

describe.skipIf(!have)('compare on real data with planted edits', () => {
  const csv = have ? load(CSV) : null!;
  const xlsx = have ? load(MODEL, 'Sales Detail') : null!;

  for (const seed of [3, 11, 29]) {
    it(`seed ${seed}: reports exactly the planted edits`, () => {
      const rand = rng(seed);
      const old: SheetData = { name: 'old', headers: [...xlsx.headers], rows: xlsx.rows.map((r) => [...r]) };
      const keyCol = old.headers.indexOf('sale_id');
      const units = old.headers.indexOf('units');
      const region = old.headers.indexOf('region');
      const pickRow = () => Math.floor(rand() * old.rows.length);
      const used = new Set<number>();
      const pick = () => {
        for (;;) {
          const r = pickRow();
          if (!used.has(r)) {
            used.add(r);
            return r;
          }
        }
      };

      // Rows removed from old -> they show as added in new.
      const addedIds = Array.from({ length: 5 }, () => old.rows[pick()][keyCol]);
      // Rows that exist only in old -> removed.
      const removedIds = Array.from({ length: 4 }, (_, i) => `SAL-OLD-${seed}-${i}`);
      // Cells changed in old -> changed (new value is the CSV's).
      const changed = new Map<string, Set<string>>();
      for (let i = 0; i < 6; i++) {
        const r = pick();
        const id = old.rows[r][keyCol];
        const cols = new Set<string>();
        old.rows[r][units] = String(Number(old.rows[r][units]) + 7);
        cols.add('units');
        if (i % 2 === 0) {
          old.rows[r][region] = `${old.rows[r][region]}-旧`;
          cols.add('region');
        }
        changed.set(id, cols);
      }
      // A key duplicated in old, and a row with an empty key.
      const dupRow = pick();
      const dupId = old.rows[dupRow][keyCol];
      const emptyKeyRow = pick();
      const emptyKeyId = old.rows[emptyKeyRow][keyCol];
      const template = old.rows[0];

      const addedSet = new Set(addedIds);
      old.rows = old.rows.filter((r) => !addedSet.has(r[keyCol]));
      for (const id of removedIds) old.rows.push(template.map((v, c) => (c === keyCol ? id : v)));
      old.rows.push(old.rows.find((r) => r[keyCol] === dupId)!.map((v) => v));
      old.rows.find((r) => r[keyCol] === emptyKeyId)![keyCol] = '';
      // Shuffle: compare matches by key, not position.
      for (let i = old.rows.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [old.rows[i], old.rows[j]] = [old.rows[j], old.rows[i]];
      }

      const result = compareSheets(old, csv, { keys: ['sale_id'] });
      const id = (k: string[]) => k[0];
      // The empty-key row's id no longer exists in old, so it shows as added too.
      expect(new Set(result.added.map((x) => id(x.key)))).toEqual(new Set([...addedIds, emptyKeyId]));
      expect(new Set(result.removed.map((x) => id(x.key)))).toEqual(new Set(removedIds));
      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0]).toMatchObject({ key: [dupId], side: 'old' });
      expect(result.duplicates[0].rows).toHaveLength(2);
      expect(result.emptyKey).toEqual([{ side: 'old', row: old.rows.findIndex((r) => r[keyCol] === '') }]);
      const changedById = new Map(result.changed.map((c) => [id(c.key), c]));
      expect(new Set(changedById.keys())).toEqual(new Set([...changed.keys()].filter((k) => k !== dupId)));
      for (const [cid, cols] of changed) {
        if (cid === dupId) continue;
        const c = changedById.get(cid)!;
        expect(new Set(c.changes.map((x) => x.column))).toEqual(cols);
        const u = c.changes.find((x) => x.column === 'units')!;
        expect(u.delta).toBe(-7);
        // Positions point at the right rows in each table.
        expect(old.rows[c.oldRow][keyCol]).toBe(cid);
        expect(csv.rows[c.newRow][keyCol]).toBe(cid);
      }
      // Everything else matched as unchanged even though 30,000+ cells differ as text.
      const accounted = result.added.length + result.changed.length + result.unchanged + 1; /* dup */
      expect(accounted).toBe(csv.rows.length);
    });
  }

  it('the workbook and the CSV are identical by value, different by text', () => {
    const byValue = compareSheets(xlsx, csv, { keys: ['sale_id'] });
    expect(byValue.changed).toHaveLength(0);
    expect(byValue.unchanged).toBe(csv.rows.length);
    const byText = compareSheets(xlsx, csv, { keys: ['sale_id'], numericByValue: false });
    expect(byText.changed.length).toBeGreaterThan(1000);
    expect(byText.changed[0].changes[0]).not.toHaveProperty('delta', undefined);
  });

  it('a two-column key matches rows that one column cannot', () => {
    // period_id + product_id repeats across regions/channels; adding customer_id narrows it.
    const loose = compareSheets(csv, csv, { keys: ['period_id', 'product_id'] });
    expect(loose.duplicates.length).toBeGreaterThan(0);
    expect(loose.unchanged).toBe(0);
    const full = compareSheets(csv, csv, { keys: ['sale_id'] });
    expect(full.unchanged).toBe(csv.rows.length);
    expect(full.duplicates).toEqual([]);
  });

  it('result table lists every non-unchanged row with old and new values side by side', () => {
    const old: SheetData = { ...xlsx, rows: xlsx.rows.slice(0, 200).map((r) => [...r]) };
    old.rows[10][old.headers.indexOf('units')] = '999';
    const result = compareSheets(old, csv, { keys: ['sale_id'] });
    const table = compareToSheet(result, old, csv);
    expect(table.rows).toHaveLength(result.changed.length + result.added.length + result.removed.length);
    expect(table.headers.slice(0, 3)).toEqual(['状态', 'sale_id', '变化列']);
    const mod = table.rows.find((r) => r[0] === '修改')!;
    expect(mod[2]).toBe('units');
    const ui = table.headers.indexOf('units（旧）');
    expect(mod[ui]).toBe('999');
    expect(mod[ui + 1]).toBe(csv.rows[10][csv.headers.indexOf('units')]);
    expect(table.rows.filter((r) => r[0] === '新增')).toHaveLength(csv.rows.length - 200);
  });

  it('does not change either input', () => {
    const a = JSON.stringify(xlsx);
    const b = JSON.stringify(csv);
    compareToSheet(compareSheets(xlsx, csv, { keys: ['sale_id'] }), xlsx, csv);
    expect(JSON.stringify(xlsx)).toBe(a);
    expect(JSON.stringify(csv)).toBe(b);
  });
});
