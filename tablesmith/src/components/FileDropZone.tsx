import React, { useState, useCallback } from 'react';
import { UploadCloud, Loader2, ClipboardPaste } from 'lucide-react';
import { SUPPORTED_FORMATS_LABEL } from '../services/fileService';
import type { FileImportApi } from '../hooks/useFileImport';

interface FileDropZoneProps {
  importer: FileImportApi;
}

const FileDropZone: React.FC<FileDropZoneProps> = ({ importer }) => {
  const { busyLabel, pickFiles, importDropped, pasteClipboard } = importer;
  const [isDragging, setIsDragging] = useState(false);
  const busy = busyLabel !== null;

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  // Browser mode only; in the desktop app Tauri delivers drops through useFileImport.
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      void importDropped(Array.from(e.dataTransfer.files));
    },
    [importDropped],
  );

  const handleClipboardPaste = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void pasteClipboard();
    },
    [pasteClipboard],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-busy={busy}
      onClick={() => !busy && void pickFiles()}
      onKeyDown={(e) => {
        if (!busy && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          void pickFiles();
        }
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-14 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500
        ${busy ? 'cursor-progress' : 'cursor-pointer'}
        ${
          isDragging
            ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/30'
            : 'border-gray-300 dark:border-gray-800 bg-white dark:bg-[#111827] hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/30 dark:hover:bg-blue-950/20'
        }`}
    >
      {busy ? (
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
          {busyLabel ?? '拖入文件，或点击选择文件（可多选）'}
        </p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">支持 {SUPPORTED_FORMATS_LABEL}</p>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={handleClipboardPaste}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 shadow-xs transition hover:bg-white dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-300 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
        >
          <ClipboardPaste size={14} className="text-blue-500" />
          粘贴剪贴板数据
        </button>
      </div>
    </div>
  );
};

export default FileDropZone;
