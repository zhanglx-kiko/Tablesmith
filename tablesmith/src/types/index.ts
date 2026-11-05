export interface SheetData {
  name: string;
  headers: string[];
  rows: string[][];
}

export interface FileData {
  fileName: string;
  fileType: string;
  sheets: SheetData[];
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
