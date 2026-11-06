export interface SheetData {
  name: string;
  headers: string[];
  /** Raw values as text (full precision); every calculation uses these. */
  rows: string[][];
  /**
   * What Excel shows for each cell, same shape as `rows`; null where it equals the raw
   * text. Omitted when the sheet has no formatted cells (see docs/display-formats.md).
   */
  display?: (string | null)[][];
  /**
   * The Excel formula behind each cell (without "="), same shape as `rows`; null for
   * typed values. `rows` keeps the value Excel last calculated. Omitted when the sheet has
   * no formulas. Travels with its cell through row / column operations and is dropped
   * where the value changes, like `display`.
   */
  formulas?: (string | null)[][];
}

export interface FileData {
  fileName: string;
  fileType: string;
  sheets: SheetData[];
  /** What the importer skipped or converted (hidden sheets, note rows, encoding, ...). */
  importNotes?: string[];
}

export type ChartType = 'line' | 'bar' | 'pie' | 'scatter' | 'area';

export type PaletteTheme =
  | 'business'
  | 'tech'
  | 'morandi'
  | 'sunset'
  | 'ocean'
  | 'purple'
  | 'green'
  | 'amber';

export type ColorTone = 'light' | 'normal' | 'deep';

export interface ChartConfig {
  type: ChartType;
  title: string;
  xField: string;
  yFields: string[];
  colors?: string[];
  stack?: boolean;
  showLabel?: boolean;
  paletteTheme?: PaletteTheme;
  colorTone?: ColorTone;
  colorLightness?: number; // 20 ~ 80 (50 is default/standard)
  isDark?: boolean;
  xLabelRotate?: number;
  showGridLines?: boolean;
}

export type ExportFormat = 'xlsx' | 'csv' | 'json' | 'xml' | 'yaml' | 'sql';
