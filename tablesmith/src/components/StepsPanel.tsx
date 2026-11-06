import React from 'react';
import { FolderOpen, ListOrdered, Play, Save, Undo2, X } from 'lucide-react';
import type { SheetData } from '../types';
import type { RecipeStep } from '../services/recipeService';

/** A step applied in the data processing page. `step` is null for joins/unions, which read a second table and cannot be saved. */
export interface AppliedStep {
  step: RecipeStep | null;
  label: string;
  rowsBefore: number;
  rowsAfter: number;
  sheet: SheetData;
}

/** Steps recorded on another sheet, offered for replay after switching sheets. */
export interface CarriedSteps {
  from: string;
  steps: RecipeStep[];
}

interface StepsPanelProps {
  steps: AppliedStep[];
  carried: CarriedSteps | null;
  onUndo: () => void;
  onSave: () => void;
  onLoad: () => void;
  onReplayCarried: () => void;
  onDismissCarried: () => void;
}

const btn =
  'flex items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-[11px] font-medium text-gray-600 dark:text-gray-300 transition hover:bg-gray-50 dark:hover:bg-gray-800 active:scale-95 disabled:opacity-40 disabled:pointer-events-none cursor-pointer';

/** Applied steps in order, with undo, save to file and replay from file. */
const StepsPanel: React.FC<StepsPanelProps> = ({ steps, carried, onUndo, onSave, onLoad, onReplayCarried, onDismissCarried }) => {
  const unsaveable = steps.find((s) => s.step === null);
  return (
    <section data-testid="steps-panel" aria-label="处理步骤" className="border-t border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-950/60 px-4 py-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200">
        <ListOrdered size={13} className="text-blue-500" />
        处理步骤（{steps.length}）
      </h3>

      {carried && (
        <div data-testid="carried-steps" className="mt-2 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 p-2 text-[11px] text-gray-700 dark:text-gray-200">
          <p>
            「{carried.from}」上记录了 {carried.steps.length} 个步骤，可以在当前表上按同样顺序再做一遍。
          </p>
          <div className="mt-1.5 flex gap-1.5">
            <button type="button" onClick={onReplayCarried} className={`${btn} flex-1 border-blue-300 dark:border-blue-800 text-blue-600 dark:text-blue-400`}>
              <Play size={11} /> 在当前表重放
            </button>
            <button type="button" onClick={onDismissCarried} aria-label="不重放" className={btn}>
              <X size={11} />
            </button>
          </div>
        </div>
      )}

      {steps.length === 0 ? (
        <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">在上方执行的清洗、筛选、计算列、脱敏、删列、透视会按顺序记录在这里，可保存后用于下个月的同类表格。</p>
      ) : (
        <ol className="mt-2 max-h-40 space-y-1 overflow-y-auto text-[11px]" data-testid="steps-list">
          {steps.map((s, i) => (
            <li key={i} className="flex items-baseline gap-1.5 text-gray-700 dark:text-gray-200">
              <span className="w-4 shrink-0 text-right text-gray-400">{i + 1}.</span>
              <span className="min-w-0 flex-1 break-words">{s.label}</span>
              <span className="shrink-0 tabular-nums text-gray-400" title="执行前 → 执行后的行数">
                {s.rowsBefore}→{s.rowsAfter} 行
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <button type="button" onClick={onUndo} disabled={steps.length === 0} className={btn} title="撤销最后一个步骤">
          <Undo2 size={11} /> 撤销
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={steps.length === 0 || Boolean(unsaveable)}
          className={btn}
          title={unsaveable ? `「${unsaveable.label}」用到另一张表，不能保存为步骤文件` : '把这些步骤保存为文件'}
        >
          <Save size={11} /> 保存步骤
        </button>
        <button type="button" onClick={onLoad} className={btn} title="打开步骤文件，在当前表上按顺序执行">
          <FolderOpen size={11} /> 应用文件
        </button>
      </div>
      {unsaveable && (
        <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
          「{unsaveable.label}」用到另一张表，含这一步时不能保存步骤文件。
        </p>
      )}
    </section>
  );
};

export default StepsPanel;
