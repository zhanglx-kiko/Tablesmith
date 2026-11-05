import type { ChartConfig, SheetData, PaletteTheme } from '../types';
import type { EChartsOption } from 'echarts';
import { parseNumericCell } from '../utils/numberUtils';

export const PALETTES: Record<PaletteTheme, string[]> = {
  business: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'],
  tech: ['#06b6d4', '#6366f1', '#ec4899', '#10b981', '#f43f5e', '#8b5cf6', '#38bdf8', '#eab308'],
  morandi: ['#78716c', '#0284c7', '#059669', '#d97706', '#7c3aed', '#db2777', '#4b5563', '#65a30d'],
  sunset: ['#f97316', '#ef4444', '#f59e0b', '#e11d48', '#fbbf24', '#c2410c', '#fb7185', '#b45309'],
  ocean: ['#2563eb', '#3b82f6', '#60a5fa', '#0284c7', '#38bdf8', '#0ea5e9', '#1d4ed8', '#93c5fd'],
  purple: ['#7c3aed', '#8b5cf6', '#a78bfa', '#9333ea', '#c084fc', '#6366f1', '#4f46e5', '#c4b5fd'],
  green: ['#059669', '#10b981', '#34d399', '#16a34a', '#22c55e', '#14b8a6', '#0d9488', '#6ee7b7'],
  amber: ['#d97706', '#f59e0b', '#fbbf24', '#ea580c', '#f97316', '#fb923c', '#ca8a04', '#fcd34d'],
};

/**
 * Convert Hex color string (e.g. #3b82f6) to RGB values.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('');
  }
  const num = parseInt(clean, 16);
  if (isNaN(num)) return { r: 59, g: 130, b: 246 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * Convert RGB values to HSL color representation.
 */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rN:
        h = (gN - bN) / d + (gN < bN ? 6 : 0);
        break;
      case gN:
        h = (bN - rN) / d + 2;
        break;
      case bN:
        h = (rN - gN) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hueToRgb(p: number, q: number, t: number): number {
  let temp = t;
  if (temp < 0) temp += 1;
  if (temp > 1) temp -= 1;
  if (temp < 1 / 6) return p + (q - p) * 6 * temp;
  if (temp < 1 / 2) return q;
  if (temp < 2 / 3) return p + (q - p) * (2 / 3 - temp) * 6;
  return p;
}

/**
 * Convert HSL to Hex color string.
 */
function hslToHex(h: number, s: number, l: number): string {
  let r: number;
  let g: number;
  let b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Adjust hex color tone or lightness (0~100 or 'light' | 'normal' | 'deep')
 * 50 = standard / balanced
 * > 50 = lighter / pastel (up to 80%)
 * < 50 = deeper / rich / darker (down to 20%)
 */
export function adjustColorLightness(
  hex: string,
  lightness: number | 'light' | 'normal' | 'deep' = 50,
): string {
  let targetL: number;
  if (typeof lightness === 'string') {
    if (lightness === 'light') targetL = 68;
    else if (lightness === 'deep') targetL = 32;
    else targetL = 50;
  } else {
    targetL = Math.max(20, Math.min(80, lightness));
  }

  if (targetL === 50) return hex;

  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);

  const delta = (targetL - 50) / 100;
  const newL = Math.max(0.16, Math.min(0.88, l + delta * 0.52));
  const newS = delta > 0 ? Math.max(0.48, s * 0.95) : Math.min(1.0, s * 1.1);

  return hslToHex(h, newS, newL);
}

/**
 * Build an ECharts option object from a ChartConfig and SheetData.
 */
export function buildChartOption(
  config: ChartConfig,
  data: SheetData,
): EChartsOption {
  const chosenPalette = config.paletteTheme ? PALETTES[config.paletteTheme] : PALETTES.business;
  const rawColors = config.colors ?? chosenPalette;
  const toneSetting = config.colorLightness ?? config.colorTone ?? 50;
  const colors = rawColors.map((c) => adjustColorLightness(c, toneSetting));
  const isDark = config.isDark ?? false;

  const textColor = isDark ? '#f3f4f6' : '#1f2937';
  const subTextColor = isDark ? '#9ca3af' : '#4b5563';
  const splitLineColor = isDark ? '#374151' : '#e5e7eb';
  const axisLineColor = isDark ? '#4b5563' : '#cbd5e1';

  const xIndex = data.headers.indexOf(config.xField);
  const xData = xIndex >= 0 ? data.rows.map((r) => r[xIndex]) : [];

  const baseSeries = config.yFields.map((yField, idx) => {
    const yIndex = data.headers.indexOf(yField);
    const yData =
      yIndex >= 0
        ? data.rows.map((r) => {
            const num = parseNumericCell(r[yIndex]);
            return isNaN(num) ? 0 : num;
          })
        : [];
    return { name: yField, rawData: yData, color: colors[idx % colors.length] };
  });

  // --- Pie chart ---
  if (config.type === 'pie') {
    const first = baseSeries[0];
    const pieData = xData.map((label, i) => ({
      name: String(label),
      value: first?.rawData[i] ?? 0,
    }));

    return {
      backgroundColor: 'transparent',
      title: {
        text: config.title,
        left: 'center',
        textStyle: { fontSize: 16, fontWeight: 600, color: textColor },
      },
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { bottom: 10, type: 'scroll', textStyle: { color: subTextColor } },
      color: colors,
      series: [
        {
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 6, borderColor: isDark ? '#1f2937' : '#fff', borderWidth: 2 },
          label: {
            show: config.showLabel ?? false,
            color: textColor,
            fontSize: 12,
            fontWeight: 600,
            formatter: '{b}: {c} ({d}%)',
          },
          emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold' } },
          data: pieData,
        },
      ],
    };
  }

  // --- Cartesian charts (line / bar / scatter / area) ---
  const chartTypeMap: Record<string, string> = {
    line: 'line',
    bar: 'bar',
    scatter: 'scatter',
    area: 'line',
  };
  const eType = chartTypeMap[config.type] ?? 'line';

  const series = baseSeries.map((s) => {
    const base: Record<string, unknown> = {
      name: s.name,
      type: eType,
      data: s.rawData,
      smooth: true,
      itemStyle: { color: s.color },
      label: {
        show: config.showLabel ?? false,
        position: 'top',
        distance: 6,
        color: isDark ? '#ffffff' : '#111827',
        fontSize: 12,
        fontWeight: 'bold',
        textBorderColor: isDark ? '#111827' : '#ffffff',
        textBorderWidth: 3,
      },
    };

    if (config.stack && (config.type === 'bar' || config.type === 'line' || config.type === 'area')) {
      base.stack = 'total';
    }

    if (config.type === 'area') {
      base.areaStyle = { opacity: 0.25 };
    }
    return base;
  });

  return {
    backgroundColor: 'transparent',
    title: {
      text: config.title,
      left: 'center',
      textStyle: { fontSize: 16, fontWeight: 500, color: textColor },
    },
    tooltip: { trigger: 'axis' },
    legend: { bottom: 10, type: 'scroll', textStyle: { color: subTextColor } },
    grid: {
      top: 60,
      right: 30,
      bottom: (config.xLabelRotate ?? 0) > 0 ? 80 : 60,
      left: 60,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: xData,
      axisTick: { alignWithLabel: true },
      axisLine: { lineStyle: { color: axisLineColor } },
      axisLabel: {
        color: subTextColor,
        rotate: config.xLabelRotate ?? 0,
      },
    },
    yAxis: {
      type: 'value',
      splitLine: {
        show: config.showGridLines ?? true,
        lineStyle: { type: 'dashed', color: splitLineColor },
      },
      axisLabel: { color: subTextColor },
    },
    color: colors,
    series,
  };
}
