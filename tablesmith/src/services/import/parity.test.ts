// Desktop (Rust calamine) vs SheetJS imports of the same file. The desktop path is the
// reference (it is what users run, checked against desktop Excel in display.test.ts);
// SheetJS is the fallback for files calamine cannot read. Payload snapshots come from
// `cargo test --lib export_payloads -- --ignored`; the suite is skipped without them.
//
// What must match exactly: sheet names, headers, row count and every raw value. Raw values
// feed every calculation, so a reader-dependent raw value would change results.
// What may differ: display text, only where SheetJS lacks the cell's format code (zh-CN
// built-in ids 27-36 / 50-58 in some containers, see docs/display-formats.md).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SheetData } from '../../types';
import { ImportError, parseDesktopPayload, parseFileBytes, type ReadFileResponse } from './index';
import { serialToText } from './numberFormat';

const PAYLOADS = join(__dirname, '../../../src-tauri/target/import-payloads');
const SOURCES = [join(__dirname, '../../../sample-data/edge-cases'), 'D:/tmp/excel'];

type Snapshot = { ok: ReadFileResponse } | { err: string };

function sourcePath(name: string): string | undefined {
  return SOURCES.map((dir) => join(dir, name)).find((p) => existsSync(p));
}

function outcome(run: () => ReturnType<typeof parseFileBytes>): SheetData[] | 'ImportError' {
  try {
    return run().file.sheets;
  } catch (err) {
    if (err instanceof ImportError) return 'ImportError';
    throw err;
  }
}

/**
 * The one agreed difference: under a zh-CN built-in date format SheetJS cannot resolve,
 * the fallback keeps the stored serial (`45322.5734`) where the desktop reader shows the
 * date (`2024-01-31 13:45:41`). Both are the same stored value; anything else must match.
 */
function sameStoredValue(fallback: string, desktop: string): boolean {
  if (fallback === desktop) return true;
  const serial = Number(fallback);
  if (!/^\d+(\.\d+)?$/.test(fallback) || !Number.isFinite(serial)) return false;
  return serialToText(serial, false) === desktop;
}

function rawDiffs(fallback: SheetData[], desktop: SheetData[]): string[] {
  const out: string[] = [];
  if (fallback.length !== desktop.length) return [`sheet count ${fallback.length} vs ${desktop.length}`];
  fallback.forEach((f, i) => {
    const d = desktop[i];
    if (f.name !== d.name) out.push(`sheet ${i}: ${f.name} vs ${d.name}`);
    if (JSON.stringify(f.headers) !== JSON.stringify(d.headers)) out.push(`${f.name} headers differ`);
    if (f.rows.length !== d.rows.length) out.push(`${f.name} rows ${f.rows.length} vs ${d.rows.length}`);
    f.rows.forEach((row, r) =>
      row.forEach((v, c) => {
        const dv = d.rows[r]?.[c] ?? '';
        if (!sameStoredValue(v, dv)) out.push(`${f.name} r${r}c${c}: fallback=${JSON.stringify(v)} desktop=${JSON.stringify(dv)}`);
      }),
    );
  });
  return out;
}

const names = existsSync(PAYLOADS) ? readdirSync(PAYLOADS).map((f) => f.replace(/\.json$/, '')) : [];

describe.skipIf(names.length === 0)('desktop / browser parity', () => {
  it.each(names)('%s', (name) => {
    const source = sourcePath(name);
    if (!source) return;
    const browser = outcome(() => parseFileBytes(name, new Uint8Array(readFileSync(source))));
    const snapshot = JSON.parse(readFileSync(join(PAYLOADS, `${name}.json`), 'utf8')) as Snapshot;

    if ('err' in snapshot) {
      expect(browser).toBe('ImportError');
      return;
    }
    // Unparsed: the desktop client itself falls back to SheetJS, nothing to compare.
    if (snapshot.ok.kind === 'unparsed') return;
    const desktop = outcome(() => parseDesktopPayload(name, snapshot.ok as Exclude<ReadFileResponse, { kind: 'unparsed' }>));
    // A file one side rejects must be rejected by the other too (invalid.json, empty files).
    if (desktop === 'ImportError' || browser === 'ImportError') {
      expect(browser).toBe(desktop);
      return;
    }
    expect(rawDiffs(browser, desktop)).toEqual([]);
  });
});
