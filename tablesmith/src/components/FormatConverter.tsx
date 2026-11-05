import React, { useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, Download } from 'lucide-react';
import { useDataStore } from '../store/useDataStore';
import { exportFile } from '../services/fileService';
import type { ExportFormat } from '../types';
import ExportModal from './ExportModal';

const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'csv', label: 'CSV (.csv)' },
  { value: 'json', label: 'JSON (.json)' },
  { value: 'xml', label: 'XML (.xml)' },
  { value: 'yaml', label: 'YAML (.yaml)' },
  { value: 'sql', label: 'SQL 插入脚本 (.sql)' },
];

export interface ConversionRecord {
  source: string;
  target: ExportFormat;
  time: string;
  success: boolean;
}

interface FormatConverterProps {
  onConvert?: (record: ConversionRecord) => void;
}

const FormatConverter: React.FC<FormatConverterProps> = ({ onConvert }) => {
  const { files, showToast } = useDataStore();
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [selectedSheetIdx, setSelectedSheetIdx] = useState(0);
  const [targetFormat, setTargetFormat] = useState<ExportFormat>('csv');
  const [delimiter, setDelimiter] = useState(',');
  const [prettyJson, setPrettyJson] = useState(true);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const activeFile = files[selectedFileIdx] ?? null;
  const sheets = activeFile?.sheets ?? [];
  const activeSheet = sheets[selectedSheetIdx] ?? null;

  const defaultBaseName = activeFile
    ? `${activeFile.fileName.replace(/\.[^/.]+$/, '')}_转换`
    : '转换导出';

  const handleOpenExportModal = () => {
    if (!activeFile || !activeSheet) {
      showToast({ type: 'info', title: '请先导入或选择数据文件' });
      return;
    }
    setIsExportModalOpen(true);
  };

  const handleConfirmConvert = async (customFileName: string, targetDirectory?: string) => {
    if (!activeFile || !activeSheet) return;
    setStatus('loading');
    setErrorMsg('');

    try {
      const result = await exportFile(activeSheet, targetFormat, customFileName, targetDirectory);
      if (result.saved) {
        setStatus('success');
        showToast({
          type: 'success',
          title: '文件导出成功',
          message: `已保存至: ${result.path || result.fileName}`,
          path: result.path,
        });
        onConvert?.({
          source: activeFile.fileName,
          target: targetFormat,
          time: new Date().toLocaleTimeString(),
          success: true,
        });
      } else {
        setStatus('idle');
      }
      setIsExportModalOpen(false);
    } catch (err: unknown) {
      setStatus('error');
      const msg = err instanceof Error ? err.message : '转换失败';
      setErrorMsg(msg);
      showToast({
        type: 'error',
        title: '导出失败',
        message: msg,
      });
      onConvert?.({
        source: activeFile?.fileName ?? '',
        target: targetFormat,
        time: new Date().toLocaleTimeString(),
        success: false,
      });
    }
  };

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-gray-400 dark:text-gray-500 shadow-xs">
        <p className="text-sm">请先导入数据文件</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-xs">
      <h3 className="mb-4 text-sm font-semibold text-gray-800 dark:text-gray-100">格式转换</h3>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Source File */}
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          源文件
          <select
            value={selectedFileIdx}
            onChange={(e) => {
              setSelectedFileIdx(Number(e.target.value));
              setSelectedSheetIdx(0);
            }}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-200 outline-none focus:border-blue-500"
          >
            {files.map((f, i) => (
              <option key={i} value={i}>
                {f.fileName}
              </option>
            ))}
          </select>
        </label>

        {/* Source Sheet */}
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          工作表
          <select
            value={selectedSheetIdx}
            onChange={(e) => setSelectedSheetIdx(Number(e.target.value))}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-200 outline-none focus:border-blue-500"
          >
            {sheets.map((s, i) => (
              <option key={i} value={i}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {/* Target Format */}
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          目标格式
          <select
            value={targetFormat}
            onChange={(e) => setTargetFormat(e.target.value as ExportFormat)}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-200 outline-none focus:border-blue-500"
          >
            {FORMAT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>

        {/* Options */}
        <div className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          <span>选项</span>
          {targetFormat === 'csv' && (
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-200">
              分隔符
              <select
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value)}
                className="ml-auto bg-transparent text-sm outline-none text-gray-800 dark:text-gray-200"
              >
                <option value="," className="dark:bg-gray-800">, (逗号)</option>
                <option value=";" className="dark:bg-gray-800">; (分号)</option>
                <option value={'\t'} className="dark:bg-gray-800">Tab</option>
              </select>
            </label>
          )}
          {targetFormat === 'json' && (
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-200 cursor-pointer">
              <input
                type="checkbox"
                checked={prettyJson}
                onChange={(e) => setPrettyJson(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600 text-blue-600"
              />
              格式化输出
            </label>
          )}
          {targetFormat !== 'csv' && targetFormat !== 'json' && (
            <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
              默认设置
            </div>
          )}
        </div>
      </div>

      {/* Action */}
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={handleOpenExportModal}
          disabled={status === 'loading' || !activeSheet}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.97] disabled:opacity-50"
        >
          {status === 'loading' ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Download size={15} />
          )}
          转换并导出
        </button>

        {status === 'success' && (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={14} /> 导出成功
          </span>
        )}
        {status === 'error' && (
          <span className="flex items-center gap-1 text-xs text-red-500">
            <AlertCircle size={14} /> {errorMsg}
          </span>
        )}
      </div>

      {/* Export Confirmation & Location Customization Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        title={`导出为 ${targetFormat.toUpperCase()} 文件`}
        defaultFileName={defaultBaseName}
        format={targetFormat}
        isExporting={status === 'loading'}
        onClose={() => setIsExportModalOpen(false)}
        onConfirm={handleConfirmConvert}
      />
    </div>
  );
};

export default FormatConverter;
