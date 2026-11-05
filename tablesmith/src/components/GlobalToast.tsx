import React from 'react';
import { CheckCircle2, AlertCircle, Info, X, FolderOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useDataStore } from '../store/useDataStore';

const GlobalToast: React.FC = () => {
  const toasts = useDataStore((s) => s.toasts);
  const dismissToast = useDataStore((s) => s.dismissToast);

  const handleOpenFolder = async (path: string) => {
    if (!path) return;
    try {
      await invoke('show_in_folder', { path });
    } catch (err) {
      console.warn('Failed to open file in folder:', err);
    }
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-5 right-6 z-50 flex flex-col gap-2.5 max-w-md w-full pointer-events-none transition-all">
      {toasts.map((toast) => {
        const isSuccess = toast.type === 'success';
        const isError = toast.type === 'error';

        return (
          <div
            key={toast.id}
            data-testid="toast"
            data-type={toast.type}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-3.5 shadow-lg backdrop-blur-md transition-all duration-200 animate-in fade-in slide-in-from-top-2
              ${
                isSuccess
                  ? 'border-emerald-200 dark:border-emerald-800/60 bg-white/95 dark:bg-[#0f172a]/95 text-gray-900 dark:text-gray-100 shadow-emerald-500/5'
                  : isError
                  ? 'border-red-200 dark:border-red-800/60 bg-white/95 dark:bg-[#0f172a]/95 text-gray-900 dark:text-gray-100 shadow-red-500/5'
                  : 'border-blue-200 dark:border-blue-800/60 bg-white/95 dark:bg-[#0f172a]/95 text-gray-900 dark:text-gray-100 shadow-blue-500/5'
              }`}
          >
            <div className="mt-0.5 shrink-0">
              {isSuccess && <CheckCircle2 size={18} className="text-emerald-500" />}
              {isError && <AlertCircle size={18} className="text-red-500" />}
              {!isSuccess && !isError && <Info size={18} className="text-blue-500" />}
            </div>

            <div className="flex-1 min-w-0">
              <h5 className="text-xs font-semibold leading-tight">{toast.title}</h5>
              {toast.message && (
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-300 break-words whitespace-pre-line leading-normal">
                  {toast.message}
                </p>
              )}
              {toast.path && (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenFolder(toast.path!)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:bg-white dark:hover:bg-gray-700 hover:border-blue-300 dark:hover:border-blue-500 transition shadow-xs active:scale-95"
                  >
                    <FolderOpen size={12} className="text-amber-500" />
                    在文件夹中显示
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="shrink-0 rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition"
              aria-label="关闭提示"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default GlobalToast;
