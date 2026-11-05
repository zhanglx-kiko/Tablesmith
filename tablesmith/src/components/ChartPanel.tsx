import React, { useState, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { Download, BarChart3, Palette, Layers, Tag, SunMedium } from 'lucide-react';
import type { SheetData, ChartConfig, ChartType, PaletteTheme } from '../types';
import { buildChartOption } from '../services/chartService';
import { useDataStore, getIsDark } from '../store/useDataStore';
import ExportModal from './ExportModal';
import { saveExport } from '../services/fileService';

interface ChartPanelProps {
  sheetData: SheetData;
  config?: ChartConfig;
}

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'line', label: '折线图' },
  { value: 'bar', label: '柱状图' },
  { value: 'pie', label: '饼图' },
  { value: 'scatter', label: '散点图' },
  { value: 'area', label: '面积图' },
];

const PALETTE_OPTIONS: { value: PaletteTheme; label: string; previewColor: string }[] = [
  { value: 'business', label: '商务经典', previewColor: '#3b82f6' },
  { value: 'tech', label: '数智科技', previewColor: '#06b6d4' },
  { value: 'morandi', label: '莫兰迪', previewColor: '#78716c' },
  { value: 'sunset', label: '落日晚霞', previewColor: '#f97316' },
  { value: 'ocean', label: '海洋蓝', previewColor: '#2563eb' },
  { value: 'purple', label: '极光紫', previewColor: '#7c3aed' },
  { value: 'green', label: '翡翠绿', previewColor: '#059669' },
  { value: 'amber', label: '琥珀橙', previewColor: '#d97706' },
];

const ChartPanel: React.FC<ChartPanelProps> = ({ sheetData, config }) => {
  const chartRef = useRef<ReactECharts>(null);
  const theme = useDataStore((s) => s.theme);
  const showToast = useDataStore((s) => s.showToast);
  const isDark = getIsDark(theme);

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [chartType, setChartType] = useState<ChartType>(config?.type ?? 'bar');
  const [title, setTitle] = useState(config?.title ?? '');
  const [xField, setXField] = useState<string>(config?.xField ?? sheetData.headers[0] ?? '');
  const [yFields, setYFields] = useState<string[]>(
    config?.yFields ?? (sheetData.headers.length > 1 ? [sheetData.headers[1]] : []),
  );
  const [paletteTheme, setPaletteTheme] = useState<PaletteTheme>(config?.paletteTheme ?? 'business');
  const [colorLightness, setColorLightness] = useState<number>(config?.colorLightness ?? 50);
  const [stack, setStack] = useState(false);
  const [showLabel, setShowLabel] = useState(false);
  const [xRotate, setXRotate] = useState<number>(0);
  const [showGridLines, setShowGridLines] = useState<boolean>(true);

  const toggleYField = (field: string) => {
    setYFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field],
    );
  };

  const chartConfig = useMemo<ChartConfig>(
    () => ({
      type: chartType,
      title,
      xField,
      yFields,
      paletteTheme,
      colorLightness,
      stack,
      showLabel,
      isDark,
      xLabelRotate: xRotate,
      showGridLines,
    }),
    [chartType, title, xField, yFields, paletteTheme, colorLightness, stack, showLabel, isDark, xRotate, showGridLines],
  );

  const option = useMemo(
    () => buildChartOption(chartConfig, sheetData),
    [chartConfig, sheetData],
  );

  const defaultExportName = title ? `${title}_图表` : `${sheetData.name || '数据'}_图表`;

  const handleConfirmExport = async (customFileName: string, targetDirectory?: string) => {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance) return;
    setIsExporting(true);
    try {
      const url = instance.getDataURL({
        type: 'png',
        pixelRatio: 2,
        backgroundColor: isDark ? '#111827' : '#ffffff',
      });
      const binary = atob(url.replace(/^data:image\/png;base64,/, ''));
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      const result = await saveExport(
        `${customFileName}.png`,
        bytes,
        { name: 'PNG Image', extensions: ['png'] },
        targetDirectory,
      );
      if (!result.saved) return;
      showToast({
        type: 'success',
        title: '图表导出成功',
        message: `图片已保存至: ${result.path}`,
        path: result.path,
      });
      setIsExportModalOpen(false);
    } catch (err: unknown) {
      showToast({
        type: 'error',
        title: '导出失败',
        message: err instanceof Error ? err.message : '保存图表图片时出现错误',
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
        {/* Chart Type */}
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          图表类型
          <select
            value={chartType}
            onChange={(e) => setChartType(e.target.value as ChartType)}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-800 dark:text-gray-100 outline-none focus:border-blue-400"
          >
            {CHART_TYPES.map((ct) => (
              <option key={ct.value} value={ct.value} className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100">
                {ct.label}
              </option>
            ))}
          </select>
        </label>

        {/* Title */}
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          标题
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="图表标题"
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-800 dark:text-gray-100 outline-none focus:border-blue-400 placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
        </label>

        {/* X Axis */}
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          X 轴字段
          <select
            value={xField}
            onChange={(e) => setXField(e.target.value)}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-800 dark:text-gray-100 outline-none focus:border-blue-400"
          >
            {sheetData.headers.map((h) => (
              <option key={h} value={h} className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100">
                {h}
              </option>
            ))}
          </select>
        </label>

        {/* Palette theme */}
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1">
            <Palette size={12} className="text-blue-500" />
            配色主题
          </span>
          <select
            value={paletteTheme}
            onChange={(e) => setPaletteTheme(e.target.value as PaletteTheme)}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-800 dark:text-gray-100 outline-none focus:border-blue-400"
          >
            {PALETTE_OPTIONS.map((p) => (
              <option key={p.value} value={p.value} className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100">
                {p.label}
              </option>
            ))}
          </select>
        </label>

        {/* Color Lightness / Custom shade */}
        <div className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          <span className="flex items-center justify-between gap-1">
            <span className="flex items-center gap-1">
              <SunMedium size={12} className="text-amber-500" />
              色彩深浅
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-400 font-mono">{colorLightness}%</span>
          </span>
          <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1">
            <div className="flex items-center rounded-md bg-gray-100 dark:bg-gray-900 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setColorLightness(68)}
                className={`rounded px-1.5 py-0.5 transition ${
                  colorLightness > 60
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-300 shadow-xs font-semibold'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
                title="浅淡明快风格 (68%)"
              >
                浅亮
              </button>
              <button
                type="button"
                onClick={() => setColorLightness(50)}
                className={`rounded px-1.5 py-0.5 transition ${
                  colorLightness >= 45 && colorLightness <= 60
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-300 shadow-xs font-semibold'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
                title="标准平衡原色 (50%)"
              >
                标准
              </button>
              <button
                type="button"
                onClick={() => setColorLightness(32)}
                className={`rounded px-1.5 py-0.5 transition ${
                  colorLightness < 45
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-300 shadow-xs font-semibold'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
                title="浓郁沉稳深调 (32%)"
              >
                浓郁
              </button>
            </div>
            <input
              type="range"
              min="20"
              max="80"
              step="2"
              value={colorLightness}
              onChange={(e) => setColorLightness(Number(e.target.value))}
              className="w-16 h-1.5 accent-blue-600 cursor-pointer"
              title={`微调深浅度: ${colorLightness}%`}
            />
          </div>
        </div>

        {/* Quick Toggles: Stack & ShowLabel & GridLines */}
        <div className="flex items-center gap-2 pb-0.5">
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50">
            <input
              type="checkbox"
              checked={stack}
              onChange={(e) => setStack(e.target.checked)}
              className="rounded text-blue-600"
            />
            <Layers size={13} className="text-blue-500" />
            堆叠累加
          </label>

          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50">
            <input
              type="checkbox"
              checked={showLabel}
              onChange={(e) => setShowLabel(e.target.checked)}
              className="rounded text-blue-600"
            />
            <Tag size={13} className="text-emerald-500" />
            数值标签
          </label>

          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50">
            <input
              type="checkbox"
              checked={showGridLines}
              onChange={(e) => setShowGridLines(e.target.checked)}
              className="rounded text-blue-600"
            />
            <BarChart3 size={13} className="text-sky-500" />
            网格辅助线
          </label>

          {/* X Axis Label Rotation */}
          <label className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-gray-700 dark:text-gray-300">
            <span>X轴防重叠:</span>
            <select
              value={xRotate}
              onChange={(e) => setXRotate(Number(e.target.value))}
              className="rounded bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 px-2 py-0.5 text-xs font-medium border border-gray-200 dark:border-gray-700 outline-none cursor-pointer focus:border-blue-500"
            >
              <option value={0} className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100">水平 (0°)</option>
              <option value={30} className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100">倾斜 (30°)</option>
              <option value={45} className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100">倾斜 (45°)</option>
              <option value={90} className="bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100">垂直 (90°)</option>
            </select>
          </label>
        </div>

        {/* Y Axis (multi-select via checkboxes) */}
        <div className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400 w-full">
          <span>Y 轴对比序列</span>
          <div className="flex flex-wrap gap-2">
            {sheetData.headers
              .filter((h) => h !== xField)
              .map((h) => (
                <label
                  key={h}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors
                    ${
                      yFields.includes(h)
                        ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-300'
                    }`}
                >
                  <input
                    type="checkbox"
                    checked={yFields.includes(h)}
                    onChange={() => toggleYField(h)}
                    className="sr-only"
                  />
                  {h}
                </label>
              ))}
          </div>
        </div>

        {/* Export */}
        <button
          onClick={() => setIsExportModalOpen(true)}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.97]"
        >
          <Download size={13} />
          导出高清 PNG
        </button>
      </div>

      {/* Export Confirmation & Location Customization Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        title="导出高清图表图片 (PNG)"
        defaultFileName={defaultExportName}
        format="png"
        isExporting={isExporting}
        onClose={() => setIsExportModalOpen(false)}
        onConfirm={handleConfirmExport}
      />

      {/* Chart */}
      <div className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm min-h-[360px]">
        {yFields.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-400">
            <BarChart3 size={40} strokeWidth={1.2} />
            <p className="text-xs">请选择至少一个 Y 轴对比序列</p>
          </div>
        ) : (
          <ReactECharts
            ref={chartRef}
            option={option}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
            notMerge
          />
        )}
      </div>
    </div>
  );
};

export default ChartPanel;
