// Desktop (Rust calamine) and browser (SheetJS) imports must produce identical tables.
// Payload snapshots come from `cargo test --lib export_payloads -- --ignored`; the suite
// is skipped when they have not been generated.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImportError, parseDesktopPayload, parseFileBytes, type ReadFileResponse } from './index';

const PAYLOADS = join(__dirname, '../../../src-tauri/target/import-payloads');
const SOURCES = [join(__dirname, '../../../sample-data/edge-cases'), 'D:/tmp/excel'];

type Snapshot = { ok: ReadFileResponse } | { err: string };

function sourcePath(name: string): string | undefined {
  return SOURCES.map((dir) => join(dir, name)).find((p) => existsSync(p));
}

function outcome(run: () => ReturnType<typeof parseFileBytes>) {
  try {
    const { file } = run();
    return { sheets: file.sheets };
  } catch (err) {
    if (err instanceof ImportError) return { error: 'ImportError' };
    throw err;
  }
}

const names = existsSync(PAYLOADS) ? readdirSync(PAYLOADS).map((f) => f.replace(/\.json$/, '')) : [];

describe.skipIf(names.length === 0)('desktop / browser parity', () => {
  it.each(names)('%s', (name) => {
    const source = sourcePath(name);
    if (!source) return;
    const bytes = new Uint8Array(readFileSync(source));
    const browser = outcome(() => parseFileBytes(name, bytes));
    const snapshot = JSON.parse(readFileSync(join(PAYLOADS, `${name}.json`), 'utf8')) as Snapshot;

    if ('err' in snapshot) {
      expect(browser).toEqual({ error: 'ImportError' });
      return;
    }
    const payload = snapshot.ok;
    // Unparsed: the desktop client falls back to the browser parser, so parity is trivial.
    if (payload.kind === 'unparsed') return;
    const desktop = outcome(() => parseDesktopPayload(name, payload));
    expect(desktop).toEqual(browser);
  });
});
