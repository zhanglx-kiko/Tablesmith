import React, { useEffect } from 'react';
import { PlusCircle, Rows3, X } from 'lucide-react';
import DataTable from './DataTable';
import type { PivotCellDetail } from '../services/pivotTableService';

interface PivotDetailModalProps {
  detail: PivotCellDetail | null;
  /** The pivot cell's value as shown, e.g. "12,855.4" or "12.34%". */
  value: string;
  onClose: () => void;
  onSaveAsSheet: (detail: PivotCellDetail) => void;
}

/**
 * Source rows behind one pivot cell (Excel's Show Details). Read-only preview; saving
 * adds the rows as a new sheet, like Excel's double-click does.
 */
const PivotDetailModal: React.FC<PivotDetailModalProps> = ({ detail, value, onClose, onSaveAsSheet }) => {
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail, onClose]);

  if (!detail) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" data-testid="pivot-detail">
      <div onClick={onClose} className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-xs" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pivot-detail-title"
        className="relative flex h-[min(80vh,720px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111827] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 dark:border-gray-800/80 px-5 py-3.5">
          <div className="min-w-0">
            <h3 id="pivot-detail-title" className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              <Rows3 size={16} className="shrink-0 text-blue-600 dark:text-blue-400" />
              <span className="truncate" title={detail.label}>
                明细：{detail.label}
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400" data-testid="pivot-detail-summary">
              透视值 <span className="font-mono text-gray-700 dark:text-gray-200">{value}</span> 来自下面{' '}
              <strong className="text-gray-700 dark:text-gray-200">{detail.sheet.rows.length}</strong> 行源数据
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => onSaveAsSheet(detail)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition active:scale-95"
            >
              <PlusCircle size={13} /> 另存为新工作表
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭明细"
              className="rounded-lg p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <DataTable sheetData={detail.sheet} />
        </div>
      </div>
    </div>
  );
};

export default PivotDetailModal;
