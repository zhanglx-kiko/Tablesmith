// Display text must stay attached to the right raw value through every processing step,
// and must never reveal a value an operation changed (masking, trimming). Run on the real
// financial model, whose sheets carry thousands of formatted cells.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SheetData } from '../types';
import { parseFileBytes } from './import';
import {
  deleteColumns,
  filterRows,
  maskColumnData,
  removeDuplicates,
  removeEmptyRows,
  trimWhitespace,
} from './dataProcessService';
import { exportRows } from './fileService';

const MODEL = 'D:/tmp/excel/Financial_BP_Rolling_Forecast.xlsx';

function formattedSheets(): SheetData[] {
  const { file } = parseFileBytes('model.xlsx', new Uint8Array(readFileSync(MODEL)));
  return file.sheets.filter((s) => s.display && s.display.some((row) => row.some((d) => d)));
}

/** Map each (raw row as JSON) to its display row, to check pairs survive an operation. */
function pairs(sheet: SheetData): Map<string, string> {
  const out = new Map<string, string>();
  sheet.rows.forEach((row, r) => out.set(JSON.stringify(row), JSON.stringify(sheet.display?.[r] ?? [])));
  return out;
}

function expectAligned(before: SheetData, after: SheetData): void {
  expect(after.display?.length ?? 0).toBe(before.display ? after.rows.length : 0);
  const original = pairs(before);
  after.rows.forEach((row, r) => {
    const key = JSON.stringify(row);
    if (original.has(key)) expect(JSON.stringify(after.display?.[r] ?? [])).toBe(original.get(key));
  });
}

describe.skipIf(!existsSync(MODEL))('display stays aligned with raw values (financial model)', () => {
  const sheets = formattedSheets();

  it('has formatted sheets to test against', () => {
    expect(sheets.length).toBeGreaterThan(5);
    const formatted = sheets.reduce((n, s) => n + (s.display?.flat().filter(Boolean).length ?? 0), 0);
    // 2,950 formatted cells in the current model; guard against the fixture silently shrinking.
    expect(formatted).toBeGreaterThan(2500);
  });

  it('filter keeps each row with its own display', () => {
    for (const sheet of sheets) {
      const col = sheet.headers[0];
      const { result } = filterRows(sheet, [{ id: '1', column: col, operator: 'isNotEmpty', value: '' }], 'all');
      expectAligned(sheet, result);
      // Keep every other row by a value that is in the data, so rows really are dropped.
      const target = sheet.rows[Math.floor(sheet.rows.length / 2)]?.[0] ?? '';
      const { result: some } = filterRows(sheet, [{ id: '1', column: col, operator: 'notEquals', value: target }], 'all');
      expect(some.rows.length).toBeLessThan(sheet.rows.length);
      expectAligned(sheet, some);
    }
  });

  it('dedupe and empty-row removal keep display aligned', () => {
    for (const sheet of sheets) {
      // Duplicate every row, then dedupe: the result must equal the original exactly.
      const doubled: SheetData = {
        ...sheet,
        rows: [...sheet.rows, ...sheet.rows],
        display: [...(sheet.display ?? []), ...(sheet.display ?? [])],
      };
      const { result } = removeDuplicates(doubled);
      expectAligned(doubled, result);
      expect(result.rows.length).toBeLessThanOrEqual(sheet.rows.length);
      // Interleave empty rows, then remove them.
      const blank = sheet.headers.map(() => '');
      const spaced: SheetData = {
        ...sheet,
        rows: sheet.rows.flatMap((row) => [blank, row]),
        display: (sheet.display ?? []).flatMap((row) => [sheet.headers.map(() => null), row]),
      };
      const { result: cleaned } = removeEmptyRows(spaced);
      expectAligned(spaced, cleaned);
    }
  });

  it('deleting columns removes the same display columns', () => {
    for (const sheet of sheets) {
      if (sheet.headers.length < 3) continue;
      const drop = [sheet.headers[1]];
      const result = deleteColumns(sheet, drop);
      expect(result.headers).not.toContain(drop[0]);
      result.rows.forEach((row, r) => {
        const src = sheet.rows[r];
        const srcDisp = sheet.display?.[r] ?? [];
        const keep = sheet.headers.map((_, i) => i).filter((i) => i !== 1);
        expect(row).toEqual(keep.map((i) => src[i] ?? ''));
        expect(result.display?.[r]).toEqual(keep.map((i) => srcDisp[i] ?? null));
      });
    }
  });

  it('masking never leaves the original visible through its Excel text', () => {
    for (const sheet of sheets) {
      for (const col of sheet.headers) {
        const ci = sheet.headers.indexOf(col);
        if (!sheet.display?.some((row) => row[ci])) continue;
        for (const type of ['all', 'name', 'phone', 'idcard', 'email'] as const) {
          const { result } = maskColumnData(sheet, col, type);
          result.rows.forEach((row, r) => {
            if (row[ci] !== sheet.rows[r][ci]) expect(result.display?.[r]?.[ci] ?? null).toBeNull();
          });
        }
      }
    }
  });

  it('trimming keeps display only where the raw value did not change', () => {
    for (const sheet of sheets) {
      const padded: SheetData = { ...sheet, rows: sheet.rows.map((row) => row.map((v, c) => (c === 0 ? ` ${v} ` : v))) };
      const result = trimWhitespace(padded);
      result.rows.forEach((row, r) => {
        row.forEach((v, c) => {
          const before = padded.rows[r][c];
          const expected = v === before ? (padded.display?.[r]?.[c] ?? null) : null;
          expect(result.display?.[r]?.[c] ?? null).toBe(expected);
        });
      });
    }
  });

  it('exports raw values by default and Excel text only when asked', () => {
    for (const sheet of sheets) {
      expect(exportRows(sheet, 'raw')).toBe(sheet.rows);
      const shown = exportRows(sheet, 'display');
      shown.forEach((row, r) =>
        row.forEach((v, c) => expect(v).toBe(sheet.display?.[r]?.[c] || sheet.rows[r][c])),
      );
    }
  });
});
