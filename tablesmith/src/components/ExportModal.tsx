import React, { useState, useEffect, useRef } from 'react';
import { Download, X, FolderOpen, Loader2, FileSpreadsheet, Image as ImageIcon, FileText } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { resolveDefaultExportDir, setLastExportDir, type ExportContent } from '../services/fileService';

interface ExportModalProps {
  isOpen: boolean;
  title?: string;
  defaultFileName: string;
  format: string;
  onClose: () => void;
  onConfirm: (customFileName: string, targetDirectory?: string, content?: ExportContent) => Promise<void> | void;
  isExporting?: boolean;
  /** Show the raw / Excel-text choice (sheets that carry Excel number formats). */
  offerContentChoice?: boolean;
}

const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  title = '导出并保存文件',
  defaultFileName,
  format,
  onClose,
  onConfirm,
  isExporting = false,
  offerContentChoice = false,
}) => {
  const [fileName, setFileName] = useState('');
  const [content, setContent] = useState<ExportContent>('raw');
  const [targetDirectory, setTargetDirectory] = useState('');
  const [isResolvingDir, setIsResolvingDir] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setFileName(defaultFileName);
      setContent('raw');
      let active = true;
      setIsResolvingDir(true);

      resolveDefaultExportDir().then((resolved) => {
        if (active) {
          if (resolved) {
            setTargetDirectory(resolved);
          }
          setIsResolvingDir(false);
        }
      });

      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);

      return () => {
        active = false;
      };
    }
  }, [isOpen, defaultFileName]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape' && !isExporting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isExporting, onClose]);

  if (!isOpen) return null;

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: targetDirectory || undefined,
        title: '选择导出保存目录',
      });
      if (selected && typeof selected === 'string') {
        setTargetDirectory(selected);
        setLastExportDir(selected);
      }
    } catch (err) {
      console.warn('Folder selection cancelled or failed:', err);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isExporting) return;
    const finalName = fileName.trim() || defaultFileName;
    onConfirm(finalName, targetDirectory || undefined, offerContentChoice ? content : 'raw');
  };

  const getFormatIcon = () => {
    const fmt = format.toLowerCase();
    if (fmt === 'png' || fmt === 'jpg' || fmt === 'jpeg') {
      return <ImageIcon size={20} className="text-blue-500" />;
    }
    if (fmt === 'pdf') {
      return <FileText size={20} className="text-red-500" />;
    }
    return <FileSpreadsheet size={20} className="text-emerald-500" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Frosted Glass Backdrop */}
      <div
        onClick={!isExporting ? onClose : undefined}
        className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-xs transition-opacity animate-in fade-in"
      />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111827] shadow-2xl transition-all duration-200 animate-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800/80 px-6 py-4">
          <div className="flex items-center gap-2.5">
            {getFormatIcon()}
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          </div>
          <button
            type="button"
            disabled={isExporting}
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition disabled:opacity-50"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* File Name Field */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              文件名
            </label>
            <div className="relative flex items-center">
              <input
                ref={inputRef}
                type="text"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder={defaultFileName}
                className="w-full rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/60 px-3.5 py-2.5 pr-20 text-xs text-gray-900 dark:text-gray-100 outline-none transition focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-500/20"
              />
              <span className="absolute right-2.5 rounded-md bg-gray-200/80 dark:bg-gray-700/80 px-2 py-1 font-mono text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase">
                .{format.toLowerCase()}
              </span>
            </div>
          </div>

          {/* Save Directory Field */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              保存目录
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={targetDirectory || (isResolvingDir ? '正在读取保存目录…' : '请选择目标目录')}
                placeholder="目标目录"
                title={targetDirectory}
                className="flex-1 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/60 px-3.5 py-2 text-xs font-mono text-gray-700 dark:text-gray-200 outline-none select-all"
              />
              <button
                type="button"
                onClick={handleSelectFolder}
                className="flex items-center gap-1.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition shrink-0 active:scale-95 shadow-xs"
              >
                <FolderOpen size={14} className="text-amber-500" />
                浏览
              </button>
            </div>
          </div>

          {offerContentChoice && (
            <fieldset data-testid="export-content">
              <legend className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">导出内容</legend>
              <div className="space-y-1.5 text-xs text-gray-700 dark:text-gray-200">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="export-content"
                    checked={content === 'raw'}
                    onChange={() => setContent('raw')}
                    className="mt-0.5 accent-blue-600"
                  />
                  <span>
                    原始值
                    <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                      文件里存的值，数字保留完整精度，适合继续计算
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="export-content"
                    checked={content === 'display'}
                    onChange={() => setContent('display')}
                    className="mt-0.5 accent-blue-600"
                  />
                  <span>
                    Excel 显示的文字
                    <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                      如 $28,975,558、61.4%，导出后是文本，不能再参与计算
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-gray-100 dark:border-gray-800/80">
            <button
              type="button"
              disabled={isExporting}
              onClick={onClose}
              className="rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition active:scale-95 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isExporting}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-md shadow-blue-500/20 hover:bg-blue-700 active:scale-95 transition disabled:opacity-60"
            >
              {isExporting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  导出中…
                </>
              ) : (
                <>
                  <Download size={14} />
                  导出
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ExportModal;
