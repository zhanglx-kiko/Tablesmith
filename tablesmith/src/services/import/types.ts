/**
 * Contract between spreadsheet readers (Rust calamine in desktop mode, SheetJS in
 * the worker) and the shared normalizer. Mirrors `GridCell` / `RawSheet` /
 * `RawWorkbook` in `src-tauri/src/commands.rs`; change both sides together.
 */

/** Date / time / datetime already formatted as `YYYY-MM-DD`, `HH:MM:SS` or `YYYY-MM-DD HH:MM:SS`. */
export interface DateCell {
  date: string;
  /** Excel serial number, present when the cell came from a spreadsheet. */
  serial?: number;
}

/** Excel error value such as `#DIV/0!`. */
export interface ErrorCell {
  error: string;
}

export type GridCell = null | string | number | boolean | DateCell | ErrorCell;

/** Inclusive merged range `[firstRow, firstCol, lastRow, lastCol]`, relative to `cells`. */
export type MergeRange = [number, number, number, number];

export interface RawSheet {
  name: string;
  hidden: boolean;
  /** Sheet address (0-based row, col) of `cells[0][0]`. */
  origin: [number, number];
  cells: GridCell[][];
  merges: MergeRange[];
  /** Formula cells that carry no cached result (file saved by a tool that never calculated). */
  uncachedFormulas: number;
  /** Number format codes used in the sheet; `#14` is built-in id 14 (see numberFormat.ts). */
  formats: string[];
  /** Same shape as `cells`: index into `formats`, -1 for General. Empty when unknown. */
  cellFormats: number[][];
}

export interface RawWorkbook {
  sheets: RawSheet[];
  notices: string[];
  /** Serial 0 is 1904-01-01 (Mac workbooks). */
  date1904: boolean;
}

/** User-facing import failure; `message` is shown as-is in the UI. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export function isDateCell(cell: GridCell): cell is DateCell {
  return typeof cell === 'object' && cell !== null && 'date' in cell;
}

export function isErrorCell(cell: GridCell): cell is ErrorCell {
  return typeof cell === 'object' && cell !== null && 'error' in cell;
}
