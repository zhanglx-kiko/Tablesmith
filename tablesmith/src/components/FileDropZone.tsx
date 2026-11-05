import React, { useState, useCallback } from 'react';
import { UploadCloud, Loader2, ClipboardPaste } from 'lucide-react';
import { openFileDialog, readBrowserFile, importFromClipboard } from '../services/fileService';
import { useDataStore } from '../store/useDataStore';

const FileDropZone: React.FC = () => {
  const addFile = useDataStore((s) => s.addFile);
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const file = await openFileDialog();
      if (file) {
        addFile(file);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '导入失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [addFile]);

  const handleClipboardPaste = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      setLoading(true);
      setError(null);
      try {
        const file = await importFromClipboard();
        if (file) {
          addFile(file);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : '剪贴板数据读取失败');
      } finally {
        setLoading(false);
      }
    },
    [addFile],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const droppedFiles = e.dataTransfer.files;
      if (droppedFiles && droppedFiles.length > 0) {
        setLoading(true);
        setError(null);
        try {
          const parsed = await readBrowserFile(droppedFiles[0]);
          addFile(parsed);
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : '导入失败，请重试');
        } finally {
          setLoading(false);
        }
      } else {
        handleImport();
      }
    },
    [addFile, handleImport],
  );

  return (
    <div
      onClick={handleImport}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-14 transition-colors
        ${
          isDragging
            ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/30'
            : 'border-gray-300 dark:border-gray-800 bg-white dark:bg-[#111827] hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-blue-950/20'
        }`}
    >
      {loading ? (
        <Loader2 size={40} className="animate-spin text-blue-500" />
      ) : (
        <UploadCloud
          size={40}
          strokeWidth={1.4}
          className={isDragging ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'}
        />
      )}

      <div className="text-center">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {loading ? '正在解析文件…' : '拖拽文件到这里，或点击选择文件'}
        </p>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          支持格式：Excel (.xlsx/.xls)、CSV、JSON、XML、XSD、YAML
        </p>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={handleClipboardPaste}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 shadow-xs transition hover:bg-white dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-300 active:scale-95"
        >
          <ClipboardPaste size={14} className="text-blue-500" />
          粘贴剪贴板数据
        </button>
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-red-50 dark:bg-red-950/50 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
};

export default FileDropZone;
