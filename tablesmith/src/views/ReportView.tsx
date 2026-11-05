import React, { useState, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import {
  FileText,
  Download,
  Printer,
  Sparkles,
  BarChart2,
  Table as TableIcon,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import { useDataStore } from '../store/useDataStore';
import { buildChartOption } from '../services/chartService';
import { exportReportToPdf, printReport } from '../services/reportService';
import ExportModal from '../components/ExportModal';
import { parseNumericCell } from '../utils/numberUtils';
import type { ChartType, ChartConfig } from '../types';

const ReportView: React.FC = () => {
  const { files, activeFileIndex, activeSheetIndex, setActiveFile, setActiveSheet } =
    useDataStore();

  const reportRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  const activeFile = files[activeFileIndex] ?? null;
  const currentSheet = activeFile?.sheets[activeSheetIndex] ?? null;

  // Report metadata
  const [reportTitle, setReportTitle] = useState('业务运营与数据统计报告');
  const [reportSubtitle, setReportSubtitle] = useState('基于导入报表的多维度综合数据分析');
  const [reportAuthor, setReportAuthor] = useState('数据分析部');
  const [reportDate, setReportDate] = useState(() => new Date().toLocaleDateString('zh-CN'));
  const [analysisNotes, setAnalysisNotes] = useState(
    '根据上述报表统计显示，各项核心指标运行平稳，整体增长趋势向好。建议后续重点关注高净值品类及转化率优化。',
  );

  // KPI metrics selection
  const [kpiCol1, setKpiCol1] = useState<string>('');
  const [kpiCol2, setKpiCol2] = useState<string>('');

  // Chart configuration in report
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [chartX, setChartX] = useState<string>('');
  const [chartYs, setChartYs] = useState<string[]>([]);

  // Table rows limit
  const [tableRowCount, setTableRowCount] = useState<number>(10);

  // Initialize fields when sheet changes
  React.useEffect(() => {
    if (currentSheet && currentSheet.headers.length > 0) {
      setChartX(currentSheet.headers[0]);
      if (currentSheet.headers.length > 1) {
        setChartYs([currentSheet.headers[1]]);
        setKpiCol1(currentSheet.headers[1]);
      }
      if (currentSheet.headers.length > 2) {
        setKpiCol2(currentSheet.headers[2]);
      }
    }
  }, [currentSheet]);

  // Compute KPI values
  const kpiStats = useMemo(() => {
    if (!currentSheet) return null;

    const calcStat = (colName: string) => {
      if (!colName) return null;
      const idx = currentSheet.headers.indexOf(colName);
      if (idx < 0) return null;

      let sum = 0;
      let count = 0;
      currentSheet.rows.forEach((r) => {
        const val = parseNumericCell(r[idx]);
        if (!isNaN(val)) {
          sum += val;
          count++;
        }
      });
      const avg = count > 0 ? sum / count : 0;
      return { sum: Number(sum.toFixed(2)), avg: Number(avg.toFixed(2)), count };
    };

    return {
      totalRows: currentSheet.rows.length,
      stat1: calcStat(kpiCol1),
      stat2: calcStat(kpiCol2),
    };
  }, [currentSheet, kpiCol1, kpiCol2]);

  // Chart options
  const chartOption = useMemo(() => {
    if (!currentSheet || !chartX || chartYs.length === 0) return null;
    const config: ChartConfig = {
      type: chartType,
      title: `${currentSheet.name} - 数据可视化趋势`,
      xField: chartX,
      yFields: chartYs,
    };
    return buildChartOption(config, currentSheet);
  }, [currentSheet, chartType, chartX, chartYs]);

  const showToast = useDataStore((s) => s.showToast);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  // Handle PDF Export
  const handleOpenExportPdf = () => {
    if (!reportRef.current) return;
    setIsExportModalOpen(true);
  };

  const handleConfirmExportPdf = async (customFileName: string, targetDirectory?: string) => {
    if (!reportRef.current) return;
    setIsExporting(true);
    setExportSuccess(false);
    try {
      const result = await exportReportToPdf(reportRef.current, customFileName, targetDirectory);
      if (result.saved) {
        setExportSuccess(true);
        showToast({
          type: 'success',
          title: 'PDF 报告导出成功',
          message: `已保存至: ${result.path || result.fileName}`,
          path: result.path,
        });
        setTimeout(() => setExportSuccess(false), 3000);
      }
      setIsExportModalOpen(false);
    } catch (err: unknown) {
      showToast({
        type: 'error',
        title: 'PDF 导出失败',
        message: err instanceof Error ? err.message : '生成 PDF 时出现错误',
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (files.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center text-gray-400">
        <FileText size={48} strokeWidth={1.2} className="mb-3 text-gray-300" />
        <h3 className="text-base font-semibold text-gray-700">暂无数据生成报表</h3>
        <p className="mt-1 text-xs text-gray-400">请先在「数据源」模块导入报表文件</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-100/70 dark:bg-gray-950/60 text-gray-900 dark:text-gray-100">
      {/* Top Toolbar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-3 shadow-xs">
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            报告数据源
            <select
              value={activeFileIndex}
              onChange={(e) => setActiveFile(Number(e.target.value))}
              className="ml-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 outline-none"
            >
              {files.map((f, i) => (
                <option key={i} value={i}>
                  {f.fileName}
                </option>
              ))}
            </select>
          </label>

          {activeFile && activeFile.sheets.length > 1 && (
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              工作表
              <select
                value={activeSheetIndex}
                onChange={(e) => setActiveSheet(Number(e.target.value))}
                className="ml-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-200 outline-none"
              >
                {activeFile.sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={printReport}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 shadow-xs transition hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95"
          >
            <Printer size={13} />
            系统打印 / 另存为 PDF
          </button>

          <button
            onClick={handleOpenExportPdf}
            disabled={isExporting}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-700 active:scale-95 disabled:opacity-50"
          >
            {isExporting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : exportSuccess ? (
              <CheckCircle2 size={13} className="text-emerald-300" />
            ) : (
              <Download size={13} />
            )}
            {isExporting ? '正在生成 PDF…' : exportSuccess ? '导出成功' : '导出 PDF 报告'}
          </button>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Config Sidebar (320px) */}
        <div className="no-print flex w-80 flex-col overflow-y-auto border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-5 text-xs text-gray-600 dark:text-gray-300">
          <div>
            <h4 className="flex items-center gap-1.5 font-semibold text-gray-800 dark:text-gray-100">
              <Sparkles size={14} className="text-blue-500" />
              报表信息设置
            </h4>
            <div className="mt-3 space-y-2.5">
              <div>
                <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">主标题</label>
                <input
                  type="text"
                  value={reportTitle}
                  onChange={(e) => setReportTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 py-1.5 text-gray-800 dark:text-gray-100 outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">副标题</label>
                <input
                  type="text"
                  value={reportSubtitle}
                  onChange={(e) => setReportSubtitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 py-1.5 text-gray-800 dark:text-gray-100 outline-none focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">编制人</label>
                  <input
                    type="text"
                    value={reportAuthor}
                    onChange={(e) => setReportAuthor(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 py-1.5 text-gray-800 dark:text-gray-100 outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">报告日期</label>
                  <input
                    type="text"
                    value={reportDate}
                    onChange={(e) => setReportDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 py-1.5 text-gray-800 dark:text-gray-100 outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <h4 className="font-semibold text-gray-800">核心指标卡片 (KPI)</h4>
            <div className="mt-3 space-y-2">
              <div>
                <label className="text-[11px] font-medium text-gray-500">指标 1 (求和统计)</label>
                <select
                  value={kpiCol1}
                  onChange={(e) => setKpiCol1(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 outline-none"
                >
                  <option value="">不展示</option>
                  {currentSheet?.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-500">指标 2 (均值统计)</label>
                <select
                  value={kpiCol2}
                  onChange={(e) => setKpiCol2(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 outline-none"
                >
                  <option value="">不展示</option>
                  {currentSheet?.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <h4 className="flex items-center gap-1.5 font-semibold text-gray-800">
              <BarChart2 size={14} className="text-blue-500" />
              嵌入图表配置
            </h4>
            <div className="mt-3 space-y-2">
              <div>
                <label className="text-[11px] font-medium text-gray-500">图表类型</label>
                <select
                  value={chartType}
                  onChange={(e) => setChartType(e.target.value as ChartType)}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 outline-none"
                >
                  <option value="bar">柱状图</option>
                  <option value="line">折线图</option>
                  <option value="pie">饼图</option>
                  <option value="area">面积图</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-500">X 轴维度</label>
                <select
                  value={chartX}
                  onChange={(e) => setChartX(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 outline-none"
                >
                  {currentSheet?.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-500">Y 轴数值序列</label>
                <select
                  value={chartYs[0] || ''}
                  onChange={(e) => setChartYs([e.target.value])}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 outline-none"
                >
                  {currentSheet?.headers
                    .filter((h) => h !== chartX)
                    .map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <h4 className="flex items-center gap-1.5 font-semibold text-gray-800 dark:text-gray-100">
              <TableIcon size={14} className="text-blue-500" />
              表格展示行数
            </h4>
            <select
              value={tableRowCount}
              onChange={(e) => setTableRowCount(Number(e.target.value))}
              className="mt-2 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2 py-1.5 text-gray-800 dark:text-gray-100 outline-none"
            >
              <option value={5}>前 5 行数据摘要</option>
              <option value={10}>前 10 行数据摘要</option>
              <option value={20}>前 20 行数据摘要</option>
              <option value={100}>全量数据 (最多 100 行)</option>
            </select>
          </div>

          <div className="border-t border-gray-100 dark:border-gray-800 pt-4">
            <h4 className="font-semibold text-gray-800 dark:text-gray-100">分析结论与说明</h4>
            <textarea
              rows={3}
              value={analysisNotes}
              onChange={(e) => setAnalysisNotes(e.target.value)}
              className="mt-2 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-2 text-xs text-gray-800 dark:text-gray-100 outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Right Preview Canvas (Scrollable A4 Canvas) */}
        <div className="flex-1 overflow-y-auto p-8 flex justify-center bg-gray-200/60 dark:bg-gray-950">
          <div
            id="report-paper"
            ref={reportRef}
            className="w-[794px] min-h-[1123px] bg-white p-12 shadow-lg rounded-sm text-gray-800 flex flex-col justify-between"
          >
            <div>
              {/* Header */}
              <div className="border-b-2 border-blue-600 pb-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wider text-blue-600 uppercase">
                    Tablesmith Business Report
                  </span>
                  <span className="text-xs text-gray-400">{reportDate}</span>
                </div>
                <h1 className="mt-2 text-2xl font-bold text-gray-900">{reportTitle}</h1>
                <p className="mt-1 text-xs text-gray-500">{reportSubtitle}</p>
                <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                  <span>编制：{reportAuthor}</span>
                  <span>•</span>
                  <span>工作表：{currentSheet?.name}</span>
                </div>
              </div>

              {/* KPI Cards Row */}
              {kpiStats && (
                <div className="mt-6 grid grid-cols-3 gap-4">
                  <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-4">
                    <p className="text-[11px] font-medium text-gray-400">数据样本总数</p>
                    <p className="mt-1 text-2xl font-bold text-gray-800">{kpiStats.totalRows} <span className="text-xs font-normal text-gray-400">行</span></p>
                  </div>
                  {kpiStats.stat1 && (
                    <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                      <p className="text-[11px] font-medium text-blue-500">{kpiCol1} (总和)</p>
                      <p className="mt-1 text-2xl font-bold text-blue-700">
                        {kpiStats.stat1.sum.toLocaleString()}
                      </p>
                    </div>
                  )}
                  {kpiStats.stat2 && (
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                      <p className="text-[11px] font-medium text-emerald-600">{kpiCol2} (平均值)</p>
                      <p className="mt-1 text-2xl font-bold text-emerald-700">
                        {kpiStats.stat2.avg.toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Embedded Chart */}
              {chartOption && (
                <div className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
                  <div className="h-64 w-full">
                    <ReactECharts
                      option={chartOption}
                      style={{ height: '100%', width: '100%' }}
                      opts={{ renderer: 'canvas' }}
                    />
                  </div>
                </div>
              )}

              {/* Executive Summary Table */}
              {currentSheet && (
                <div className="mt-8">
                  <div className="mb-2.5 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-gray-700">数据报表摘要 (前 {Math.min(tableRowCount, currentSheet.rows.length)} 行)</h3>
                    <span className="text-[11px] text-gray-400">总计 {currentSheet.rows.length} 行数据</span>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                        <tr>
                          {currentSheet.headers.map((h) => (
                            <th key={h} className="px-3 py-2 font-medium">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white text-gray-700">
                        {currentSheet.rows.slice(0, tableRowCount).map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-gray-50/50">
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} className="px-3 py-1.5 whitespace-nowrap">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Notes / Conclusion */}
              {analysisNotes && (
                <div className="mt-8 rounded-lg bg-gray-50 p-4 border-l-4 border-blue-500 text-xs leading-relaxed text-gray-600">
                  <p className="font-semibold text-gray-800 mb-1">分析总结与行动建议：</p>
                  <p>{analysisNotes}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="mt-12 border-t border-gray-100 pt-3 flex items-center justify-between text-[11px] text-gray-400">
              <span>生成工具: 表匠 Tablesmith</span>
              <span>第 1 页 / 共 1 页</span>
            </div>
          </div>
        </div>
      </div>

      {/* PDF Export Customization Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        title="导出 A4 PDF 商业报告"
        defaultFileName={reportTitle ? `${reportTitle}_分析报告` : '表匠_商业报告'}
        format="pdf"
        isExporting={isExporting}
        onClose={() => setIsExportModalOpen(false)}
        onConfirm={handleConfirmExportPdf}
      />
    </div>
  );
};

export default ReportView;
