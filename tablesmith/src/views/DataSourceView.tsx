import React, { useCallback, useState } from 'react';
import {
  Loader2,
  Plus,
  ClipboardPaste,
  Download,
  X,
} from 'lucide-react';
import { useDataStore } from '../store/useDataStore';
import FileDropZone from '../components/FileDropZone';
import DataTable from '../components/DataTable';
import ExportModal from '../components/ExportModal';
import FileTypeIcon from '../components/FileTypeIcon';
import { exportFile } from '../services/fileService';
import { useFileImport } from '../hooks/useFileImport';

const DataSourceView: React.FC = () => {
  const {
    files,
    activeFileIndex,
    activeSheetIndex,
    setActiveFile,
    setActiveSheet,
    removeFile,
    showToast,
    isInitialized,
  } = useDataStore();
  const importer = useFileImport();
  const importing = importer.busyLabel !== null;
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const activeFile = files[activeFileIndex] ?? null;
  const activeSheet = activeFile?.sheets[activeSheetIndex] ?? null;

  const defaultExportName = activeFile && activeSheet
    ? `${activeFile.fileName.replace(/\.[^/.]+$/, '')}_${activeSheet.name}`
    : '表格导出';

  const handleConfirmExport = async (customFileName: string, targetDirectory?: string) => {
    if (!activeSheet) return;
    setIsExporting(true);
    try {
      const result = await exportFile(activeSheet, 'xlsx', customFileName, targetDirectory);
      if (result.saved) {
        showToast({
          type: 'success',
          title: '表格导出成功',
          message: `已保存至: ${result.path || result.fileName}`,
          path: result.path,
        });
      }
      setIsExportModalOpen(false);
    } catch (err: unknown) {
      showToast({
        type: 'error',
        title: '导出失败',
        message: err instanceof Error ? err.message : '导出工作表时出错',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportNew = useCallback(() => void importer.pickFiles(), [importer]);
  const handleClipboardPaste = useCallback(() => void importer.pasteClipboard(), [importer]);

  if (!isInitialized) {
    return (
      <div className="flex h-full items-center justify-center p-8 bg-slate-50 dark:bg-[#0b0f19]">
        <div className="flex flex-col items-center gap-2 text-xs text-gray-400">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <span>正在恢复工作台会话...</span>
        </div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 bg-slate-50 dark:bg-[#0b0f19]">
        <div className="w-full max-w-xl">
          <FileDropZone importer={importer} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-slate-50 dark:bg-[#0b0f19] text-gray-900 dark:text-gray-100">
      {importer.isDragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-500 bg-blue-50/80 dark:bg-blue-950/60 text-sm font-medium text-blue-600 dark:text-blue-300">
          松开以导入文件
        </div>
      )}
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-2.5">
        <button
          onClick={handleImportNew}
          disabled={importing}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 shadow-xs transition hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-[0.97] cursor-pointer"
        >
          {importing ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          导入文件
        </button>

        <button
          onClick={handleClipboardPaste}
          disabled={importing}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 shadow-xs transition hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 active:scale-[0.97] cursor-pointer"
        >
          <ClipboardPaste size={14} className="text-blue-500" />
          从剪贴板粘贴
        </button>

        {importer.busyLabel && (
          <span className="text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
            {importer.busyLabel}
          </span>
        )}

        {activeSheet && (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {activeSheet.rows.length} 行 × {activeSheet.headers.length} 列
            </span>
            <button
              onClick={() => setIsExportModalOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 shadow-xs transition hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 active:scale-95 cursor-pointer"
              title="将当前工作表导出为 Excel 文件"
            >
              <Download size={13} className="text-emerald-500" />
              导出当前工作表
            </button>
          </div>
        )}
      </div>

      {/* File tabs with explicit close buttons */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-950/70 px-3 py-1">
        {files.map((f, idx) => (
          <div
            key={idx}
            onClick={() => setActiveFile(idx)}
            className={`group flex items-center gap-2 rounded-t-md px-3 py-1.5 text-xs font-medium transition-all cursor-pointer select-none border-b-2
              ${
                idx === activeFileIndex
                  ? 'bg-white dark:bg-gray-900 border-blue-500 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100/70 dark:hover:bg-gray-800/50'
              }`}
          >
            <FileTypeIcon type={f.fileType} size={13} />
            <span className="truncate max-w-[160px]" title={f.fileName}>
              {f.fileName}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeFile(idx);
              }}
              className="rounded p-0.5 text-gray-400 hover:text-red-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors opacity-70 group-hover:opacity-100"
              title={`关闭数据源: ${f.fileName}`}
              aria-label={`关闭数据源: ${f.fileName}`}
            >
              <X size={12} />
            </button>
          </div>
        ))}

        <button
          onClick={handleImportNew}
          disabled={importing}
          aria-label="导入文件"
          title="导入文件"
          className="flex items-center justify-center p-1 text-gray-400 hover:text-blue-600 hover:bg-gray-200/60 dark:hover:bg-gray-800 rounded transition-colors ml-1 cursor-pointer"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Sheet tabs */}
      {activeFile && activeFile.sheets.length > 1 && (
        <div
          data-testid="sheet-tabs"
          className="flex items-center gap-0.5 overflow-x-auto border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-4"
        >
          {activeFile.sheets.map((sheet, idx) => (
            <button
              key={idx}
              onClick={() => setActiveSheet(idx)}
              className={`shrink-0 px-3 py-1.5 text-[11px] font-medium transition-colors cursor-pointer
                ${
                  idx === activeSheetIndex
                    ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/40 rounded-t-md font-semibold'
                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-hidden">
        {activeSheet ? (
          <DataTable sheetData={activeSheet} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            无数据
          </div>
        )}
      </div>

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        onConfirm={handleConfirmExport}
        defaultFileName={defaultExportName}
        isExporting={isExporting}
        title="导出当前工作表 (Excel)"
        format="xlsx"
      />
    </div>
  );
};

export default DataSourceView;
