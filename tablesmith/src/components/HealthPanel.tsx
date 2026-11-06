import React, { useMemo } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import type { SheetData } from '../types';
import { checkSheetHealth, type HealthIssue } from '../services/healthCheckService';

interface HealthPanelProps {
  sheet: SheetData;
  onClose: () => void;
  /** Scroll the table to a data row (and column) and flash it. */
  onLocate: (row: number, column?: number) => void;
}

const SEVERITY = {
  error: { icon: AlertCircle, label: '错误', cls: 'text-red-600 dark:text-red-400' },
  warning: { icon: AlertTriangle, label: '注意', cls: 'text-amber-600 dark:text-amber-400' },
  info: { icon: Info, label: '提示', cls: 'text-blue-600 dark:text-blue-400' },
} as const;

/** How many row links to show per finding before "等 N 行". */
const ROW_LINKS = 12;

function IssueItem({ issue, onLocate }: { issue: HealthIssue; onLocate: HealthPanelProps['onLocate'] }) {
  const s = SEVERITY[issue.severity];
  const Icon = s.icon;
  return (
    <li className="px-4 py-3" data-testid="health-issue" data-kind={issue.kind}>
      <div className="flex items-start gap-2">
        <Icon size={14} className={`mt-0.5 shrink-0 ${s.cls}`} aria-label={s.label} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">{issue.title}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{issue.detail}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {issue.rows.slice(0, ROW_LINKS).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onLocate(r, issue.column)}
                className="rounded border border-gray-200 dark:border-gray-700 px-1.5 py-0.5 text-[11px] text-gray-600 dark:text-gray-300 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
                title="在表格中定位"
              >
                第 {r + 1} 行
              </button>
            ))}
            {issue.rows.length > ROW_LINKS && (
              <span className="px-1 py-0.5 text-[11px] text-gray-400">等 {issue.rows.length} 行</span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/** Read-only findings for the current sheet; nothing here changes data. */
const HealthPanel: React.FC<HealthPanelProps> = ({ sheet, onClose, onLocate }) => {
  const report = useMemo(() => checkSheetHealth(sheet), [sheet]);
  const counts = report.issues.reduce(
    (acc, i) => ({ ...acc, [i.severity]: acc[i.severity] + 1 }),
    { error: 0, warning: 0, info: 0 },
  );

  return (
    <aside
      data-testid="health-panel"
      aria-label="数据体检"
      className="flex w-80 shrink-0 flex-col border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
    >
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">数据体检</h2>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {sheet.name} · {report.rowCount} 行 × {report.columnCount} 列 · 只检查，不修改数据
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭数据体检"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200 cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>

      {report.issues.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <CheckCircle2 size={28} className="text-emerald-500" />
          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">没有发现问题</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            已检查重复行、唯一列重复、空值、首尾空格、数字格式、公式错误、数量级异常、日期写法和分类写法。
          </p>
        </div>
      ) : (
        <>
          <p className="border-b border-gray-100 dark:border-gray-800 px-4 py-1.5 text-[11px] text-gray-500 dark:text-gray-400" data-testid="health-summary">
            {counts.error} 个错误 · {counts.warning} 个注意 · {counts.info} 个提示
          </p>
          <ul className="flex-1 divide-y divide-gray-100 dark:divide-gray-800 overflow-y-auto">
            {report.issues.map((issue, i) => (
              <IssueItem key={`${issue.kind}-${issue.column ?? 'row'}-${i}`} issue={issue} onLocate={onLocate} />
            ))}
          </ul>
        </>
      )}
    </aside>
  );
};

export default HealthPanel;
