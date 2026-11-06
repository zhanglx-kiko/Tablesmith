// Data health check, tested by planting known defects into real sheets (the financial
// model and the edge-case fixtures) at random positions and requiring each one to be
// reported at exactly the planted row and column. A fixed seed keeps runs reproducible;
// several seeds cover different positions.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SheetData } from '../types';
import { parseFileBytes } from './import';
import { exactNumber } from './import/cellText';
import { checkSheetHealth, isIdentifierHeader, type HealthKind } from './healthCheckService';

const MODEL = 'D:/tmp/excel/Financial_BP_Rolling_Forecast.xlsx';
const SALES = 'D:/tmp/excel/sales_detail.csv';

function load(path: string): SheetData[] {
  return parseFileBytes(path.split('/').pop() ?? path, new Uint8Array(readFileSync(path))).file.sheets;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function clone(sheet: SheetData): SheetData {
  return { name: sheet.name, headers: [...sheet.headers], rows: sheet.rows.map((r) => [...r]) };
}

function found(sheet: SheetData, kind: HealthKind, column?: number): Set<number> {
  const rows = new Set<number>();
  for (const issue of checkSheetHealth(sheet).issues) {
    if (issue.kind === kind && (column === undefined || issue.column === column)) issue.rows.forEach((r) => rows.add(r));
  }
  return rows;
}

function numericColumns(sheet: SheetData): number[] {
  return sheet.headers.flatMap((_, c) => {
    const filled = sheet.rows.map((r) => r[c] ?? '').filter((v) => v !== '');
    return filled.length >= 20 && filled.every((v) => exactNumber(v) !== null) ? [c] : [];
  });
}

const sources = [MODEL, SALES].filter((p) => existsSync(p));
const sheets = sources.flatMap(load).filter((s) => s.rows.length >= 20 && s.headers.length >= 2);
const SEEDS = [1, 7, 42];

// Each case scans every column of every real sheet (8,640-row sheets included) several
// times; 5 s, the default, is too close to the actual ~4-5 s on this machine.
describe.skipIf(sheets.length === 0)('health check finds planted defects in real sheets', { timeout: 30_000 }, () => {
  it('has real data to plant into', () => {
    expect(sheets.length).toBeGreaterThanOrEqual(5);
    expect(sheets.reduce((n, s) => n + s.rows.length, 0)).toBeGreaterThan(5000);
    expect(sheets.some((s) => numericColumns(s).length > 0)).toBe(true);
  });

  it('never changes the sheet it checks', () => {
    for (const sheet of sheets) {
      const before = JSON.stringify(sheet);
      checkSheetHealth(sheet);
      expect(JSON.stringify(sheet)).toBe(before);
    }
  });

  for (const seed of SEEDS) {
    it(`seed ${seed}: duplicate rows are reported at the copies`, () => {
      const rand = rng(seed);
      for (const src of sheets) {
        const sheet = clone(src);
        const baseline = found(sheet, 'duplicateRow');
        // Copy 3 distinct rows to the end; the copies must be reported.
        const picks = new Set<number>();
        while (picks.size < 3) picks.add(Math.floor(rand() * src.rows.length));
        const planted: number[] = [];
        for (const r of picks) {
          if (src.rows[r].every((v) => v === '')) continue;
          planted.push(sheet.rows.length);
          sheet.rows.push([...src.rows[r]]);
        }
        const got = found(sheet, 'duplicateRow');
        for (const r of planted) expect(got.has(r), `${src.name} copy at ${r}`).toBe(true);
        for (const r of got) expect(baseline.has(r) || planted.includes(r), `${src.name} false duplicate ${r}`).toBe(true);
      }
    });

    it(`seed ${seed}: whitespace, number-as-text, non-numeric and formula errors land on the planted cell`, () => {
      const rand = rng(seed);
      for (const src of sheets) {
        const cols = numericColumns(src);
        if (cols.length === 0) continue;
        const sheet = clone(src);
        const c = cols[Math.floor(rand() * cols.length)];
        const filledRows = sheet.rows.flatMap((row, r) => (row[c] !== '' ? [r] : []));
        const pick = () => filledRows.splice(Math.floor(rand() * filledRows.length), 1)[0];
        const rText = pick();
        const rWord = pick();
        const rErr = pick();
        const rSpace = pick();
        const n = exactNumber(sheet.rows[rText][c]) ?? 0;
        sheet.rows[rText][c] = Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : `${sheet.rows[rText][c]} `;
        sheet.rows[rWord][c] = '待定';
        sheet.rows[rErr][c] = '#DIV/0!';
        sheet.rows[rSpace][c] = ` ${sheet.rows[rSpace][c]}`;

        expect(found(sheet, 'numberAsText', c).has(rText), `${src.name} numberAsText ${rText}`).toBe(true);
        expect(found(sheet, 'nonNumeric', c).has(rWord), `${src.name} nonNumeric ${rWord}`).toBe(true);
        expect(found(sheet, 'formulaError', c).has(rErr), `${src.name} formulaError ${rErr}`).toBe(true);
        expect(found(sheet, 'whitespace', c).has(rSpace), `${src.name} whitespace ${rSpace}`).toBe(true);
        // The error must not also be counted as "not a number" text.
        expect(found(sheet, 'nonNumeric', c).has(rErr)).toBe(false);
        // Nothing planted, nothing reported, for untouched numeric columns.
        for (const other of cols.filter((x) => x !== c)) {
          expect(found(sheet, 'numberAsText', other).size, `${src.name} col ${other}`).toBe(found(src, 'numberAsText', other).size);
        }
      }
    });

    it(`seed ${seed}: an extreme value is flagged as an outlier, normal values are not`, () => {
      const rand = rng(seed);
      let tested = 0;
      for (const src of sheets) {
        for (const c of numericColumns(src).filter((x) => !isIdentifierHeader(src.headers[x]))) {
          const nums = src.rows.map((r) => exactNumber(r[c] ?? '')).filter((n): n is number => n !== null);
          const maxAbs = Math.max(...nums.map(Math.abs));
          if (nums.length < 20 || maxAbs <= 0) continue;
          const before = found(src, 'outlier', c);
          const filledRows = src.rows.flatMap((row, r) => (exactNumber(row[c] ?? '') !== null ? [r] : []));
          const r = filledRows[Math.floor(rand() * filledRows.length)];

          // Two extra zeros on the largest value: the defect this rule exists for.
          const typo = clone(src);
          typo.rows[r][c] = String(maxAbs * 100);
          const after = found(typo, 'outlier', c);
          expect(after.has(r), `${src.name} col ${c} row ${r}`).toBe(true);
          for (const x of after) expect(before.has(x) || x === r).toBe(true);

          // An ordinary large value (twice the current max) is not an error.
          const large = clone(src);
          large.rows[r][c] = String(maxAbs * 2);
          expect(found(large, 'outlier', c).has(r), `${src.name} col ${c} 2x max flagged`).toBe(false);
          tested += 1;
        }
      }
      expect(tested).toBeGreaterThan(10);
    });
  }

  it('does not treat amount columns as ids that must be unique', () => {
    // debit_usd, amount_usd, cogs_usd: almost every value differs, but two equal amounts
    // are normal. Regression for a false "应唯一" error on the real model.
    for (const sheet of sheets) {
      for (const issue of checkSheetHealth(sheet).issues) {
        if (issue.kind !== 'duplicateKey' || issue.column === undefined) continue;
        const header = sheet.headers[issue.column];
        const isNumberColumn = numericColumns(sheet).includes(issue.column);
        expect(!isNumberColumn || isIdentifierHeader(header), `${sheet.name} ${header}`).toBe(true);
      }
    }
  });

  it('does not call an unusual code in an identifier column an outlier', () => {
    let tested = 0;
    for (const src of sheets) {
      for (const c of numericColumns(src).filter((x) => isIdentifierHeader(src.headers[x]))) {
        const sheet = clone(src);
        const max = Math.max(...sheet.rows.map((r) => exactNumber(r[c] ?? '') ?? -Infinity));
        sheet.rows[0][c] = String(max * 1000);
        expect(found(sheet, 'outlier', c).size, `${src.name} ${src.headers[c]}`).toBe(0);
        tested += 1;
      }
    }
    // GL Detail account_id is one such column in the financial model.
    expect(tested).toBeGreaterThan(0);
  });

  it('flags duplicate ids, mixed date formats and inconsistent spellings at the planted rows', () => {
    const rand = rng(99);
    const n = 200;
    const regions = ['华东', '华南', '华北', 'Online'];
    const sheet: SheetData = {
      name: 'synthetic',
      headers: ['订单号', '下单日期', '区域', '金额'],
      rows: Array.from({ length: n }, (_, i) => [
        `SO-${String(100000 + i)}`,
        `2024-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        regions[i % regions.length],
        String(Math.round(rand() * 100000) / 100),
      ]),
    };
    expect(checkSheetHealth(sheet).issues).toEqual([]);

    sheet.rows[150][0] = sheet.rows[10][0];
    sheet.rows[33][1] = '2024/3/5';
    sheet.rows[77][1] = '2024/7/9';
    sheet.rows[45][2] = 'online';
    sheet.rows[46][2] = 'ＯＮＬＩＮＥ';

    expect([...found(sheet, 'duplicateKey', 0)]).toEqual([10, 150]);
    expect([...found(sheet, 'mixedDateFormat', 1)]).toEqual([33, 77]);
    expect([...found(sheet, 'variantSpelling', 2)].sort((a, b) => a - b)).toEqual([45, 46]);
    expect(found(sheet, 'outlier', 3).size).toBe(0);
  });
});
