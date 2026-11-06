import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  Filter,
  Calculator,
  Trash2,
  RotateCcw,
  Save,
  PlusCircle,
  CheckCircle,
  FileSpreadsheet,
  ShieldCheck,
  GitMerge,
  Grid3X3,
  ArrowUpDown,
  Layers,
  Percent,
  SlidersHorizontal,
  BarChart3,
  Download,
} from 'lucide-react';
import { useDataStore } from '../store/useDataStore';
import DataTable from '../components/DataTable';
import ExportModal from '../components/ExportModal';
import StepsPanel, { type AppliedStep, type CarriedSteps } from '../components/StepsPanel';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import type { ReadFileResponse } from '../services/import';
import type { SheetData } from '../types';
import { exportFile, saveExport } from '../services/fileService';
import {
  RecipeError,
  describeStep,
  parseRecipe,
  runRecipe,
  serializeRecipe,
  type RecipeStep,
} from '../services/recipeService';
import {
  removeDuplicates,
  removeEmptyRows,
  trimWhitespace,
  filterRows,
  addComputedColumn,
  deleteColumns,
  maskColumnData,
  joinSheets,
  unionSheets,
  type FilterCondition,
  type FilterOperator,
  type ComputedColumnConfig,
  type MaskType,
} from '../services/dataProcessService';
import {
  generatePivotTable,
  type PivotAggType,
  type PivotValueMode,
  type PivotSortOrder,
} from '../services/pivotTableService';

const ProcessView: React.FC = () => {
  const navigate = useNavigate();
  const { files, activeFileIndex, activeSheetIndex, setActiveFile, setActiveSheet, updateSheet, addSheetToFile, showToast: showGlobalToast } =
    useDataStore();

  const activeFile = files[activeFileIndex] ?? null;
  const originalSheet = activeFile?.sheets[activeSheetIndex] ?? null;

  // Staging processed sheet data for live preview
  const [workingSheet, setWorkingSheet] = useState<SheetData | null>(originalSheet);
  const [activeTab, setActiveTab] = useState<'clean' | 'filter' | 'compute' | 'pivot' | 'mask' | 'join' | 'columns'>('clean');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isConfirmOverwriteOpen, setIsConfirmOverwriteOpen] = useState(false);

  /** Steps applied to workingSheet since it was last reset, oldest first. */
  const [steps, setSteps] = useState<AppliedStep[]>([]);
  const [carried, setCarried] = useState<CarriedSteps | null>(null);
  const sheetKeyRef = useRef(`${activeFileIndex}:${activeSheetIndex}`);
  /** Latest steps, read when the sheet changes (state updaters must stay pure). */
  const stepsRef = useRef<AppliedStep[]>([]);
  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  // Sync working sheet when selected file/sheet changes. Switching to another sheet
  // offers the recorded steps for replay there; saving over the same sheet just bakes
  // them in.
  useEffect(() => {
    const key = `${activeFileIndex}:${activeSheetIndex}`;
    const prevKey = sheetKeyRef.current;
    sheetKeyRef.current = key;
    const prev = stepsRef.current;
    if (key !== prevKey && prev.length > 0 && prev.every((x) => x.step !== null)) {
      const [f, sh] = prevKey.split(':').map(Number);
      setCarried({ from: files[f]?.sheets[sh]?.name ?? '上一个工作表', steps: prev.map((x) => x.step as RecipeStep) });
    }
    setSteps([]);
    setWorkingSheet(originalSheet);
  }, [originalSheet]);

  /** Show a step's result and add it to the step list. */
  const record = (step: RecipeStep | null, result: SheetData, label?: string) => {
    if (!workingSheet) return;
    setSteps((prev) => [
      ...prev,
      { step, label: label ?? (step ? describeStep(step) : ''), rowsBefore: workingSheet.rows.length, rowsAfter: result.rows.length, sheet: result },
    ]);
    setWorkingSheet(result);
  };

  const handleUndoStep = () => {
    setSteps((prev) => {
      const next = prev.slice(0, -1);
      setWorkingSheet(next.length ? next[next.length - 1].sheet : originalSheet);
      showToast(prev.length ? `已撤销：${prev[prev.length - 1].label}` : '没有可撤销的步骤');
      return next;
    });
  };

  /** Run recipe steps on the current table, appending each to the step list. */
  const replaySteps = (recipeSteps: RecipeStep[], source: string) => {
    if (!workingSheet) return;
    try {
      const { log } = runRecipe(workingSheet, recipeSteps);
      setSteps((prev) => [
        ...prev,
        ...log.map((l) => ({ step: l.step, label: describeStep(l.step), rowsBefore: l.rowsBefore, rowsAfter: l.rowsAfter, sheet: l.sheet })),
      ]);
      setWorkingSheet(log[log.length - 1]?.sheet ?? workingSheet);
      showGlobalToast({ type: 'success', title: `已按${source}执行 ${log.length} 个步骤`, message: `${workingSheet.rows.length} 行 → ${log[log.length - 1]?.rowsAfter ?? workingSheet.rows.length} 行` });
    } catch (err) {
      showGlobalToast({ type: 'error', title: '无法执行这些步骤', message: err instanceof RecipeError ? `${err.message}。当前表没有被修改。` : String(err) });
    }
  };

  const handleSaveSteps = async () => {
    if (!workingSheet || !originalSheet || steps.length === 0 || steps.some((x) => x.step === null)) return;
    const recipe = { version: 1 as const, name: `${originalSheet.name} 处理步骤`, sourceHeaders: originalSheet.headers, steps: steps.map((x) => x.step as RecipeStep) };
    try {
      const fileName = `${originalSheet.name.replace(/[\\/:*?"<>|]/g, '_')}_处理步骤.tablesmith-steps.json`;
      const res = await saveExport(fileName, serializeRecipe(recipe), { name: '表匠处理步骤', extensions: ['json'] });
      if (res.saved) showGlobalToast({ type: 'success', title: `已保存 ${steps.length} 个步骤`, message: `已保存至: ${res.path ?? res.fileName}`, path: res.path });
    } catch (err) {
      showGlobalToast({ type: 'error', title: '保存步骤失败', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleLoadSteps = async () => {
    const picked = await open({ multiple: false, directory: false, title: '选择处理步骤文件', filters: [{ name: '表匠处理步骤', extensions: ['json'] }] });
    if (!picked || typeof picked !== 'string') return;
    try {
      const response = await invoke<ReadFileResponse>('read_file_data', { path: picked });
      if (response.kind !== 'text') throw new RecipeError('不是表匠的处理步骤文件', -1);
      replaySteps(parseRecipe(response.text).steps, '步骤文件');
    } catch (err) {
      showGlobalToast({ type: 'error', title: '无法读取步骤文件', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // ---------------- Clean state ----------------
  const [dedupCol, setDedupCol] = useState<string>('__ALL__');

  const handleRemoveDuplicates = () => {
    if (!workingSheet) return;
    const keyCols = dedupCol === '__ALL__' ? undefined : [dedupCol];
    const { result, removedCount } = removeDuplicates(workingSheet, keyCols);
    record(keyCols ? { op: 'dedupe', columns: keyCols } : { op: 'dedupe' }, result);
    showToast(`已去除 ${removedCount} 行重复数据`);
  };

  const handleRemoveEmpty = () => {
    if (!workingSheet) return;
    const { result, removedCount } = removeEmptyRows(workingSheet);
    record({ op: 'removeEmptyRows' }, result);
    showToast(`已清除 ${removedCount} 行空数据`);
  };

  const handleTrimWhitespace = () => {
    if (!workingSheet) return;
    const result = trimWhitespace(workingSheet);
    record({ op: 'trim' }, result);
    showToast('已修剪所有单元格首尾空格');
  };

  // ---------------- Filter state ----------------
  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>([]);
  const [matchType, setMatchType] = useState<'all' | 'any'>('all');

  const addFilterRule = () => {
    if (!workingSheet || workingSheet.headers.length === 0) return;
    const newCond: FilterCondition = {
      id: Math.random().toString(36).substring(7),
      column: workingSheet.headers[0],
      operator: 'contains',
      value: '',
    };
    setFilterConditions((prev) => [...prev, newCond]);
  };

  const updateFilterRule = (id: string, updates: Partial<FilterCondition>) => {
    setFilterConditions((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    );
  };

  const removeFilterRule = (id: string) => {
    setFilterConditions((prev) => prev.filter((c) => c.id !== id));
  };

  const handleApplyFilter = () => {
    if (!workingSheet) return;
    const { result, matchCount } = filterRows(workingSheet, filterConditions, matchType);
    record(
      { op: 'filter', match: matchType, conditions: filterConditions.map(({ column, operator, value }) => ({ column, operator, value })) },
      result,
    );
    showToast(`筛选完成，保留 ${matchCount} 行符合条件的数据`);
  };

  // ---------------- Compute state ----------------
  const [newColName, setNewColName] = useState('');
  const [computeType, setComputeType] = useState<'calc' | 'combine'>('calc');
  const [computeColA, setComputeColA] = useState('');
  const [computeColB, setComputeColB] = useState('');
  const [calcOperator, setCalcOperator] = useState<'+' | '-' | '*' | '/'>('+');
  const [combineSep, setCombineSep] = useState(' - ');

  useEffect(() => {
    if (workingSheet && workingSheet.headers.length > 0) {
      setComputeColA(workingSheet.headers[0]);
      if (workingSheet.headers.length > 1) {
        setComputeColB(workingSheet.headers[1]);
      }
    }
  }, [workingSheet]);

  const handleAddComputedColumn = () => {
    if (!workingSheet || !newColName.trim()) {
      showToast('请输入新列名称');
      return;
    }
    if (workingSheet.headers.includes(newColName.trim())) {
      showToast('列名已存在，请使用其他名称');
      return;
    }

    const config: ComputedColumnConfig =
      computeType === 'calc'
        ? {
            name: newColName.trim(),
            type: 'calc',
            colA: computeColA,
            colB: computeColB,
            operator: calcOperator,
          }
        : {
            name: newColName.trim(),
            type: 'combine',
            colA: computeColA,
            colB: computeColB,
            separator: combineSep,
          };

    const result = addComputedColumn(workingSheet, config);
    record({ op: 'compute', config }, result);
    setNewColName('');
    showToast(`成功添加计算列：${config.name}`);
  };

  // ---------------- Pivot Table state ----------------
  const [pivotRow, setPivotRow] = useState<string>('');
  const [pivotSubRow, setPivotSubRow] = useState<string>('__NONE__');
  const [pivotCol, setPivotCol] = useState<string>('__NONE__');
  const [pivotVal, setPivotVal] = useState<string>('');
  const [pivotAgg, setPivotAgg] = useState<PivotAggType>('sum');
  const [pivotValueMode, setPivotValueMode] = useState<PivotValueMode>('raw');
  const [pivotFilterField, setPivotFilterField] = useState<string>('__NONE__');
  const [pivotFilterVal, setPivotFilterVal] = useState<string>('__ALL__');
  const [pivotSort, setPivotSort] = useState<PivotSortOrder>('default');
  const [pivotShowRowTotal, setPivotShowRowTotal] = useState<boolean>(true);
  const [pivotShowColTotal, setPivotShowColTotal] = useState<boolean>(true);

  useEffect(() => {
    if (workingSheet && workingSheet.headers.length > 0) {
      if (!pivotRow || !workingSheet.headers.includes(pivotRow)) {
        setPivotRow(workingSheet.headers[0]);
      }
      if (!pivotVal || !workingSheet.headers.includes(pivotVal)) {
        setPivotVal(workingSheet.headers.length > 1 ? workingSheet.headers[1] : workingSheet.headers[0]);
      }
    }
  }, [workingSheet]);

  const pivotFilterOptions = useMemo(() => {
    if (!workingSheet || pivotFilterField === '__NONE__') return [];
    const idx = workingSheet.headers.indexOf(pivotFilterField);
    if (idx < 0) return [];
    const set = new Set<string>();
    workingSheet.rows.forEach((r) => {
      const v = String(r[idx] ?? '').trim();
      if (v) set.add(v);
    });
    return Array.from(set).slice(0, 50);
  }, [workingSheet, pivotFilterField]);

  const handleApplyPivot = () => {
    if (!workingSheet || !pivotRow || !pivotVal) {
      showToast('请选择透视行维度和统计指标');
      return;
    }
    const pivotConfig = {
      rowField: pivotRow,
      subRowField: pivotSubRow === '__NONE__' ? undefined : pivotSubRow,
      colField: pivotCol === '__NONE__' ? undefined : pivotCol,
      valueField: pivotVal,
      aggType: pivotAgg,
      valueMode: pivotValueMode,
      filterField: pivotFilterField === '__NONE__' ? undefined : pivotFilterField,
      filterValue: pivotFilterVal === '__ALL__' ? undefined : pivotFilterVal,
      sortOrder: pivotSort,
      showRowTotal: pivotShowRowTotal,
      showColTotal: pivotShowColTotal,
    };
    const result = generatePivotTable(workingSheet, pivotConfig);
    record({ op: 'pivot', config: pivotConfig }, result);
    showToast(`透视表生成成功：${result.rows.length} 行 × ${result.headers.length} 列`);
  };

  // ---------------- Data Masking state ----------------
  const [maskCol, setMaskCol] = useState<string>('');
  const [maskType, setMaskType] = useState<MaskType>('phone');

  useEffect(() => {
    if (workingSheet && workingSheet.headers.length > 0) {
      setMaskCol(workingSheet.headers[0]);
    }
  }, [workingSheet]);

  const handleApplyMask = () => {
    if (!workingSheet || !maskCol) return;
    const { result, maskedCount } = maskColumnData(workingSheet, maskCol, maskType);
    record({ op: 'mask', column: maskCol, type: maskType }, result);
    showToast(`已对 [${maskCol}] 完成脱敏打码，共处理 ${maskedCount} 条记录`);
  };

  // ---------------- Multi-table Join & Merge state ----------------
  const [mergeMode, setMergeMode] = useState<'join' | 'union'>('join');
  const [targetFileIdx, setTargetFileIdx] = useState<number>(0);
  const [targetSheetIdx, setTargetSheetIdx] = useState<number>(0);
  const [joinKeyA, setJoinKeyA] = useState<string>('');
  const [joinKeyB, setJoinKeyB] = useState<string>('');
  const [joinType, setJoinType] = useState<'left' | 'inner'>('left');

  const targetFile = files[targetFileIdx] ?? null;
  const targetSheet = targetFile?.sheets[targetSheetIdx] ?? null;

  useEffect(() => {
    if (workingSheet && workingSheet.headers.length > 0) {
      setJoinKeyA(workingSheet.headers[0]);
    }
  }, [workingSheet]);

  useEffect(() => {
    if (targetSheet && targetSheet.headers.length > 0) {
      setJoinKeyB(targetSheet.headers[0]);
    }
  }, [targetSheet]);

  const handleApplyMerge = () => {
    if (!workingSheet || !targetSheet) {
      showToast('请选择目标关联表格');
      return;
    }
    if (mergeMode === 'join') {
      if (!joinKeyA || !joinKeyB) {
        showToast('请选择关联比对的主键列');
        return;
      }
      const result = joinSheets(workingSheet, targetSheet, joinKeyA, joinKeyB, joinType);
      record(null, result, `按「${joinKeyA}」=「${joinKeyB}」关联「${targetSheet.name}」`);
      showToast(`关联完成：生成新合并表 (${result.rows.length} 行 × ${result.headers.length} 列)`);
    } else {
      const result = unionSheets(workingSheet, targetSheet);
      record(null, result, `纵向拼接「${targetSheet.name}」`);
      showToast(`纵向拼接完成：生成新合并表 (${result.rows.length} 行 × ${result.headers.length} 列)`);
    }
  };

  // ---------------- Delete Column state ----------------
  const [selectedColsToDelete, setSelectedColsToDelete] = useState<string[]>([]);

  const toggleDeleteCol = (col: string) => {
    setSelectedColsToDelete((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    );
  };

  const handleDeleteColumns = () => {
    if (!workingSheet || selectedColsToDelete.length === 0) return;
    const result = deleteColumns(workingSheet, selectedColsToDelete);
    record({ op: 'deleteColumns', columns: selectedColsToDelete }, result);
    setSelectedColsToDelete([]);
    showToast(`已删除 ${selectedColsToDelete.length} 列`);
  };

  // ---------------- Save handlers ----------------
  const handleReset = () => {
    setWorkingSheet(originalSheet);
    setSteps([]);
    setFilterConditions([]);
    setSelectedColsToDelete([]);
    showToast('已重置为原始数据');
  };

  const handleSaveOverwrite = () => {
    if (!workingSheet || activeFileIndex < 0 || activeSheetIndex < 0) return;
    setIsConfirmOverwriteOpen(true);
  };

  const confirmSaveOverwrite = () => {
    if (!workingSheet || activeFileIndex < 0 || activeSheetIndex < 0) return;
    updateSheet(activeFileIndex, activeSheetIndex, workingSheet);
    setSteps([]);
    setIsConfirmOverwriteOpen(false);
    showToast('已覆盖当前工作表');
  };

  const handleSaveAsNewSheet = () => {
    if (!workingSheet || activeFileIndex < 0 || !activeFile) return;
    const baseName = `${workingSheet.name}_处理后`;
    let newName = baseName;
    const existingNames = new Set(activeFile.sheets.map((s) => s.name));
    let counter = 1;
    while (existingNames.has(newName)) {
      newName = `${baseName} (${counter})`;
      counter++;
    }
    addSheetToFile(activeFileIndex, { ...workingSheet, name: newName });
    showToast(`已另存为新工作表：${newName}`);
  };

  const handlePivotToChart = () => {
    if (!workingSheet || activeFileIndex < 0 || !activeFile) return;
    const baseName = `透视表_${pivotRow}_分析`;
    let newName = baseName;
    const existingNames = new Set(activeFile.sheets.map((s) => s.name));
    let counter = 1;
    while (existingNames.has(newName)) {
      newName = `${baseName} (${counter})`;
      counter++;
    }
    addSheetToFile(activeFileIndex, { ...workingSheet, name: newName });
    showToast(`已将透视结果保存为「${newName}」，正在前往图表...`);
    navigate('/chart');
  };

  const [pivotExportFormat, setPivotExportFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const [isPivotExportModalOpen, setIsPivotExportModalOpen] = useState(false);
  const [isPivotExporting, setIsPivotExporting] = useState(false);

  const handleOpenExportPivot = (format: 'xlsx' | 'csv') => {
    if (!workingSheet) return;
    setPivotExportFormat(format);
    setIsPivotExportModalOpen(true);
  };

  const handleConfirmExportPivot = async (customFileName: string, targetDirectory?: string) => {
    if (!workingSheet) return;
    setIsPivotExporting(true);
    try {
      const result = await exportFile(workingSheet, pivotExportFormat, customFileName, targetDirectory);
      if (result.saved) {
        showGlobalToast({
          type: 'success',
          title: '透视表导出成功',
          message: `已保存至: ${result.path || result.fileName}`,
          path: result.path,
        });
      }
      setIsPivotExportModalOpen(false);
    } catch (err: unknown) {
      showGlobalToast({
        type: 'error',
        title: '导出失败',
        message: err instanceof Error ? err.message : '导出透视表时出错',
      });
    } finally {
      setIsPivotExporting(false);
    }
  };

  // Stats comparison
  const stats = useMemo(() => {
    if (!originalSheet || !workingSheet) return null;
    const rowDiff = workingSheet.rows.length - originalSheet.rows.length;
    const colDiff = workingSheet.headers.length - originalSheet.headers.length;
    return {
      origRows: originalSheet.rows.length,
      origCols: originalSheet.headers.length,
      currRows: workingSheet.rows.length,
      currCols: workingSheet.headers.length,
      rowDiff,
      colDiff,
    };
  }, [originalSheet, workingSheet]);

  if (files.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center text-gray-400">
        <FileSpreadsheet size={48} strokeWidth={1.2} className="mb-3 text-gray-300" />
        <h3 className="text-base font-semibold text-gray-700 dark:text-gray-200">暂无数据可处理</h3>
        <p className="mt-1 text-xs text-gray-400">请先在「数据源」模块导入 Excel、CSV 或 XML 文件</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-50/50 dark:bg-gray-900/50">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-6 py-3">
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            数据文件
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

          {stats && (
            <div className="flex items-center gap-2 rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-1 text-xs text-gray-600 dark:text-gray-300">
              <span>
                当前预览: <strong>{stats.currRows}</strong> 行 × <strong>{stats.currCols}</strong> 列
              </span>
              {stats.rowDiff !== 0 && (
                <span className={stats.rowDiff < 0 ? 'text-red-500 font-semibold' : 'text-emerald-500 font-semibold'}>
                  ({stats.rowDiff > 0 ? `+${stats.rowDiff}` : stats.rowDiff} 行)
                </span>
              )}
              {stats.colDiff !== 0 && (
                <span className={stats.colDiff < 0 ? 'text-red-500 font-semibold' : 'text-emerald-500 font-semibold'}>
                  ({stats.colDiff > 0 ? `+${stats.colDiff}` : stats.colDiff} 列)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Global Save Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 shadow-sm transition hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95"
            title="撤销所有未保存的修改，还原为原始状态"
          >
            <RotateCcw size={13} />
            重置
          </button>
          <button
            onClick={handleSaveOverwrite}
            className="flex items-center gap-1.5 rounded-lg border border-blue-600 bg-blue-50 dark:bg-blue-900/30 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 shadow-sm transition hover:bg-blue-100 dark:hover:bg-blue-900/50 active:scale-95"
          >
            <Save size={13} />
            覆盖当前表
          </button>
          <button
            onClick={handleSaveAsNewSheet}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-blue-700 active:scale-95"
          >
            <PlusCircle size={13} />
            另存为新工作表
          </button>
        </div>
      </div>

      {/* Main Workspace: Left Controls (340px) + Right Preview */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Control Panel */}
        <div className="flex w-[336px] shrink-0 flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          {/* Sub Navigation Tabs */}
          <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-950 p-1 text-center text-[10px] font-medium text-gray-500 dark:text-gray-400">
            <button
              onClick={() => setActiveTab('clean')}
              className={`flex flex-col items-center gap-1 rounded-lg py-2 transition-all ${
                activeTab === 'clean'
                  ? 'bg-white dark:bg-gray-800 font-semibold text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <Sparkles size={13} />
              清洗
            </button>
            <button
              onClick={() => setActiveTab('filter')}
              className={`flex flex-col items-center gap-1 rounded-lg py-2 transition-all ${
                activeTab === 'filter'
                  ? 'bg-white dark:bg-gray-800 font-semibold text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <Filter size={13} />
              筛选
            </button>
            <button
              onClick={() => setActiveTab('compute')}
              className={`flex flex-col items-center gap-1 rounded-lg py-2 transition-all ${
                activeTab === 'compute'
                  ? 'bg-white dark:bg-gray-800 font-semibold text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <Calculator size={13} />
              计算列
            </button>
            <button
              onClick={() => setActiveTab('pivot')}
              className={`flex flex-col items-center gap-1 rounded-lg py-2 transition-all ${
                activeTab === 'pivot'
                  ? 'bg-white dark:bg-gray-800 font-semibold text-amber-600 dark:text-amber-400 shadow-xs'
                  : 'hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <Grid3X3 size={13} />
              透视表
            </button>
            <button
              onClick={() => setActiveTab('mask')}
              className={`flex flex-col items-center gap-1 rounded-lg py-2 transition-all ${
                activeTab === 'mask'
                  ? 'bg-white dark:bg-gray-800 font-semibold text-emerald-600 dark:text-emerald-400 shadow-xs'
                  : 'hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <ShieldCheck size={13} />
              脱敏
            </button>
            <button
              onClick={() => setActiveTab('join')}
              className={`flex flex-col items-center gap-1 rounded-lg py-2 transition-all ${
                activeTab === 'join'
                  ? 'bg-white dark:bg-gray-800 font-semibold text-indigo-600 dark:text-indigo-400 shadow-xs'
                  : 'hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <GitMerge size={13} />
              合并
            </button>
            <button
              onClick={() => setActiveTab('columns')}
              className={`flex flex-col items-center gap-1 rounded-lg py-2 transition-all ${
                activeTab === 'columns'
                  ? 'bg-white dark:bg-gray-800 font-semibold text-red-600 dark:text-red-400 shadow-xs'
                  : 'hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              <Trash2 size={13} />
              删列
            </button>
          </div>

          {/* Tab Content Body */}
          <div className="flex-1 overflow-y-auto p-4">
            {/* 1. Quick Clean Tab */}
            {activeTab === 'clean' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 p-3.5">
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200">
                    <Sparkles size={14} className="text-blue-500" />
                    数据去重
                  </h4>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">检测并删除重复行，保留第一条出现的记录。</p>

                  <div className="mt-3">
                    <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">依据列判定重复</label>
                    <select
                      value={dedupCol}
                      onChange={(e) => setDedupCol(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 outline-none"
                    >
                      <option value="__ALL__">全部列均相同</option>
                      {workingSheet?.headers.map((h) => (
                        <option key={h} value={h}>
                          仅依据 [{h}] 判定
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={handleRemoveDuplicates}
                    className="mt-3 w-full rounded-lg bg-blue-600 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 active:scale-95"
                  >
                    执行去重
                  </button>
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 p-3.5">
                  <h4 className="text-xs font-semibold text-gray-800 dark:text-gray-200">清除空白行</h4>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">移除整行单元格均为完全空白或无内容的无效行。</p>
                  <button
                    onClick={handleRemoveEmpty}
                    className="mt-3 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 transition hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95"
                  >
                    清除空白行
                  </button>
                </div>

                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 p-3.5">
                  <h4 className="text-xs font-semibold text-gray-800 dark:text-gray-200">修剪空白字符</h4>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">消除所有单元格两头多余的空格或回车字符。</p>
                  <button
                    onClick={handleTrimWhitespace}
                    className="mt-3 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 transition hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95"
                  >
                    修剪全部空格
                  </button>
                </div>
              </div>
            )}

            {/* 2. Filter Tab */}
            {activeTab === 'filter' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">筛选规则</span>
                  <select
                    value={matchType}
                    onChange={(e) => setMatchType(e.target.value as 'all' | 'any')}
                    className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300 outline-none"
                  >
                    <option value="all">满足所有条件 (AND)</option>
                    <option value="any">满足任一条件 (OR)</option>
                  </select>
                </div>

                {filterConditions.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-gray-200 dark:border-gray-800 p-4 text-center text-xs text-gray-400">
                    暂无规则，点击下方添加筛选条件
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {filterConditions.map((cond) => (
                      <div key={cond.id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/70 p-2.5 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <select
                            value={cond.column}
                            onChange={(e) => updateFilterRule(cond.id, { column: e.target.value })}
                            className="w-1/2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-700 dark:text-gray-200 outline-none"
                          >
                            {workingSheet?.headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                          <select
                            value={cond.operator}
                            onChange={(e) =>
                              updateFilterRule(cond.id, { operator: e.target.value as FilterOperator })
                            }
                            className="w-1/2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-700 dark:text-gray-200 outline-none"
                          >
                            <option value="contains">包含</option>
                            <option value="notContains">不包含</option>
                            <option value="equals">等于</option>
                            <option value="notEquals">不等于</option>
                            <option value="greaterThan">&gt; 大于</option>
                            <option value="lessThan">&lt; 小于</option>
                            <option value="greaterThanOrEqual">&gt;= 大于等于</option>
                            <option value="lessThanOrEqual">&lt;= 小于等于</option>
                            <option value="isEmpty">为空</option>
                            <option value="isNotEmpty">非空</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {!['isEmpty', 'isNotEmpty'].includes(cond.operator) ? (
                            <input
                              type="text"
                              value={cond.value}
                              onChange={(e) => updateFilterRule(cond.id, { value: e.target.value })}
                              placeholder="比对值..."
                              className="flex-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none focus:border-blue-400"
                            />
                          ) : (
                            <span className="flex-1 text-[11px] text-gray-400 dark:text-gray-500 italic py-1">
                              无需输入比对值 (判断空值状态)
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeFilterRule(cond.id)}
                            className="rounded p-1 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                            title="删除该条件"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={addFilterRule}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-1.5 text-xs text-gray-600 dark:text-gray-400 transition hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400"
                  >
                    <PlusCircle size={13} /> 添加筛选条件
                  </button>

                  {filterConditions.length > 0 && (
                    <button
                      onClick={() => {
                        setFilterConditions([]);
                        setWorkingSheet(originalSheet);
                        setSteps([]);
                        showToast('已清除所有筛选条件并恢复原始数据');
                      }}
                      className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition"
                      title="重置并清除所有筛选"
                    >
                      清空条件
                    </button>
                  )}
                </div>

                {filterConditions.length > 0 && (
                  <button
                    onClick={handleApplyFilter}
                    className="w-full rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-700 active:scale-95"
                  >
                    应用筛选规则
                  </button>
                )}
              </div>
            )}

            {/* 3. Compute Column Tab */}
            {activeTab === 'compute' && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">新列名称</label>
                  <input
                    type="text"
                    value={newColName}
                    onChange={(e) => setNewColName(e.target.value)}
                    placeholder="如：利润率 或 组合全称"
                    className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs text-gray-800 dark:text-gray-200 outline-none focus:border-blue-400"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">运算方式</label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setComputeType('calc')}
                      className={`rounded-lg border py-1.5 text-xs transition ${
                        computeType === 'calc'
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 font-semibold text-blue-700 dark:text-blue-300'
                          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      数值四则运算
                    </button>
                    <button
                      onClick={() => setComputeType('combine')}
                      className={`rounded-lg border py-1.5 text-xs transition ${
                        computeType === 'combine'
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 font-semibold text-blue-700 dark:text-blue-300'
                          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      文本拼接
                    </button>
                  </div>
                </div>

                {computeType === 'calc' ? (
                  <div className="space-y-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/60 p-3">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">列 A</label>
                    <select
                      value={computeColA}
                      onChange={(e) => setComputeColA(e.target.value)}
                      className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                    >
                      {workingSheet?.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>

                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">运算符</label>
                    <select
                      value={calcOperator}
                      onChange={(e) => setCalcOperator(e.target.value as '+' | '-' | '*' | '/')}
                      className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                    >
                      <option value="+">+ (相加)</option>
                      <option value="-">- (相减)</option>
                      <option value="*">* (相乘)</option>
                      <option value="/">/ (相除)</option>
                    </select>

                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">列 B</label>
                    <select
                      value={computeColB}
                      onChange={(e) => setComputeColB(e.target.value)}
                      className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                    >
                      {workingSheet?.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/60 p-3">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">前置列</label>
                    <select
                      value={computeColA}
                      onChange={(e) => setComputeColA(e.target.value)}
                      className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                    >
                      {workingSheet?.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>

                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">分隔符号</label>
                    <input
                      type="text"
                      value={combineSep}
                      onChange={(e) => setCombineSep(e.target.value)}
                      className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                    />

                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">后置列</label>
                    <select
                      value={computeColB}
                      onChange={(e) => setComputeColB(e.target.value)}
                      className="w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                    >
                      {workingSheet?.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <button
                  onClick={handleAddComputedColumn}
                  className="w-full rounded-lg bg-blue-600 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 active:scale-95"
                >
                  生成并添加该列
                </button>
              </div>
            )}

            {/* 4. Pivot Table Tab */}
            {activeTab === 'pivot' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 p-3.5 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <h4 className="flex items-center gap-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200">
                      <Grid3X3 size={14} className="text-amber-500" />
                      Excel 级多维数据透视表
                    </h4>
                    <span className="text-[10px] font-medium bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">
                      增强版
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                    媲美 Excel 透视表四象限建模：行分级展开、列交叉对比、6大统计聚合及占比分析。
                  </p>

                  {/* Zone 1: 行维度 (Rows) */}
                  <div className="space-y-2 rounded-lg border border-gray-200/80 dark:border-gray-700/80 bg-white/70 dark:bg-gray-900/70 p-2.5">
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                      <Layers size={12} />
                      行维度配置 (Rows)
                    </span>
                    <div>
                      <label className="text-[10px] text-gray-500 dark:text-gray-400">主要行分组</label>
                      <select
                        value={pivotRow}
                        onChange={(e) => setPivotRow(e.target.value)}
                        className="mt-0.5 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                      >
                        {workingSheet?.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] text-gray-500 dark:text-gray-400">次级行分组 (多层级展开，可选)</label>
                      <select
                        value={pivotSubRow}
                        onChange={(e) => setPivotSubRow(e.target.value)}
                        className="mt-0.5 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                      >
                        <option value="__NONE__">无 (单层行维度)</option>
                        {workingSheet?.headers
                          .filter((h) => h !== pivotRow)
                          .map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  {/* Zone 2: 列维度 (Columns) */}
                  <div className="space-y-1.5 rounded-lg border border-gray-200/80 dark:border-gray-700/80 bg-white/70 dark:bg-gray-900/70 p-2.5">
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      <SlidersHorizontal size={12} />
                      列交叉维度 (Columns)
                    </span>
                    <select
                      value={pivotCol}
                      onChange={(e) => setPivotCol(e.target.value)}
                      className="mt-0.5 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                    >
                      <option value="__NONE__">不使用列交叉 (单表汇总)</option>
                      {workingSheet?.headers
                        .filter((h) => h !== pivotRow && h !== pivotSubRow)
                        .map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* Zone 3: 值指标与计算 (Values) */}
                  <div className="space-y-2 rounded-lg border border-gray-200/80 dark:border-gray-700/80 bg-white/70 dark:bg-gray-900/70 p-2.5">
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                      <Calculator size={12} />
                      值指标与聚合计算 (Values)
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-500 dark:text-gray-400">统计字段</label>
                        <select
                          value={pivotVal}
                          onChange={(e) => setPivotVal(e.target.value)}
                          className="mt-0.5 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                        >
                          {workingSheet?.headers
                            .filter((h) => h !== pivotRow && h !== pivotSubRow && h !== pivotCol)
                            .map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] text-gray-500 dark:text-gray-400">聚合计算函数</label>
                        <select
                          value={pivotAgg}
                          onChange={(e) => setPivotAgg(e.target.value as PivotAggType)}
                          className="mt-0.5 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                        >
                          <option value="sum">求和 (SUM)</option>
                          <option value="avg">平均值 (AVG)</option>
                          <option value="count">计数 (COUNT)</option>
                          <option value="distinct">去重唯一计数 (DISTINCT)</option>
                          <option value="max">最大值 (MAX)</option>
                          <option value="min">最小值 (MIN)</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <Percent size={10} />
                        值显示方式 (Show Values As)
                      </label>
                      <select
                        value={pivotValueMode}
                        onChange={(e) => setPivotValueMode(e.target.value as PivotValueMode)}
                        className="mt-0.5 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                      >
                        <option value="raw">原始统计数值</option>
                        <option value="percent_total">占总计百分比 (% of Grand Total)</option>
                        <option value="percent_row">占行汇总百分比 (% of Row Total)</option>
                        <option value="percent_col">占列汇总百分比 (% of Column Total)</option>
                      </select>
                    </div>
                  </div>

                  {/* Zone 4: 筛选、排序与总计选项 */}
                  <div className="space-y-2 rounded-lg border border-gray-200/80 dark:border-gray-700/80 bg-white/70 dark:bg-gray-900/70 p-2.5">
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-purple-600 dark:text-purple-400">
                      <Filter size={12} />
                      前置过滤与排序控制
                    </span>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-500 dark:text-gray-400">筛选维度 (可选)</label>
                        <select
                          value={pivotFilterField}
                          onChange={(e) => {
                            setPivotFilterField(e.target.value);
                            setPivotFilterVal('__ALL__');
                          }}
                          className="mt-0.5 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                        >
                          <option value="__NONE__">不筛选 (全部数据)</option>
                          {workingSheet?.headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] text-gray-500 dark:text-gray-400">筛选取值</label>
                        <select
                          value={pivotFilterVal}
                          onChange={(e) => setPivotFilterVal(e.target.value)}
                          disabled={pivotFilterField === '__NONE__'}
                          className="mt-0.5 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none disabled:opacity-50"
                        >
                          <option value="__ALL__">包含所有取值</option>
                          {pivotFilterOptions.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        <ArrowUpDown size={10} />
                        排序规则
                      </label>
                      <select
                        value={pivotSort}
                        onChange={(e) => setPivotSort(e.target.value as PivotSortOrder)}
                        className="mt-0.5 w-full rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                      >
                        <option value="default">默认数据顺序</option>
                        <option value="dim_asc">行维度升序 (A-Z)</option>
                        <option value="dim_desc">行维度降序 (Z-A)</option>
                        <option value="val_desc">数值降序 (从大到小)</option>
                        <option value="val_asc">数值升序 (从小到大)</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-4 pt-1">
                      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={pivotShowRowTotal}
                          onChange={(e) => setPivotShowRowTotal(e.target.checked)}
                          className="rounded text-blue-600"
                        />
                        显示行汇总 (Row Total)
                      </label>
                      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300">
                        <input
                          type="checkbox"
                          checked={pivotShowColTotal}
                          onChange={(e) => setPivotShowColTotal(e.target.checked)}
                          className="rounded text-blue-600"
                        />
                        显示列总计 (Col Total)
                      </label>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 pt-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleApplyPivot}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white py-2 text-xs font-semibold shadow-xs transition active:scale-95"
                      >
                        <Grid3X3 size={13} />
                        生成并预览透视表
                      </button>
                      {workingSheet !== originalSheet && (
                        <button
                          onClick={handleReset}
                          className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 px-3 py-2 text-xs font-medium transition active:scale-95"
                          title="恢复未透视的原始数据"
                        >
                          <RotateCcw size={12} />
                          恢复原表
                        </button>
                      )}
                    </div>

                    <button
                      onClick={handlePivotToChart}
                      disabled={!workingSheet}
                      className="flex items-center justify-center gap-1.5 w-full rounded-lg bg-blue-600 hover:bg-blue-700 text-white py-1.5 text-xs font-semibold shadow-xs transition active:scale-95 disabled:opacity-50"
                      title="将当前透视表存为工作表并直接跳转到图表页面制作可视化"
                    >
                      <BarChart3 size={13} />
                      以透视表绘制图表
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleOpenExportPivot('xlsx')}
                        disabled={!workingSheet}
                        className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 py-1.5 text-xs font-medium transition active:scale-95 disabled:opacity-50"
                      >
                        <Download size={12} className="text-emerald-500" />
                        导出 Excel
                      </button>

                      <button
                        onClick={() => handleOpenExportPivot('csv')}
                        disabled={!workingSheet}
                        className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 py-1.5 text-xs font-medium transition active:scale-95 disabled:opacity-50"
                      >
                        <Download size={12} className="text-violet-500" />
                        导出 CSV
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSaveAsNewSheet}
                        disabled={!workingSheet}
                        className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200 py-1.5 text-xs font-medium transition active:scale-95"
                      >
                        <PlusCircle size={12} className="text-emerald-500" />
                        存为新工作表
                      </button>

                      <button
                        onClick={handleReset}
                        className="flex items-center justify-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 px-3 py-1.5 text-xs font-medium transition active:scale-95"
                        title="还原为原始数据"
                      >
                        <RotateCcw size={12} />
                        重置
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 5. Data Masking Tab */}
            {activeTab === 'mask' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 p-3.5 space-y-3">
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200">
                    <ShieldCheck size={14} className="text-emerald-500" />
                    敏感数据打码脱敏
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400">保护隐私数据，适用于演示演示、外部汇报或脱敏导出。</p>

                  <div>
                    <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">选择脱敏目标列</label>
                    <select
                      value={maskCol}
                      onChange={(e) => setMaskCol(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 outline-none"
                    >
                      {workingSheet?.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">脱敏规则类型</label>
                    <select
                      value={maskType}
                      onChange={(e) => setMaskType(e.target.value as MaskType)}
                      className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-xs text-gray-700 dark:text-gray-200 outline-none"
                    >
                      <option value="phone">手机号掩码 (如 138****5678)</option>
                      <option value="idcard">身份证号掩码 (前6后4, 中间****)</option>
                      <option value="name">中文姓名打码 (如 张*丰)</option>
                      <option value="email">电子邮箱掩码 (如 a***e@domain.com)</option>
                      <option value="all">整段文本全遮蔽 (******)</option>
                    </select>
                  </div>

                  <button
                    onClick={handleApplyMask}
                    className="w-full rounded-lg bg-emerald-600 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-700 active:scale-95"
                  >
                    执行字段脱敏
                  </button>
                </div>
              </div>
            )}

            {/* 6. Multi-table Join & Merge Tab */}
            {activeTab === 'join' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 p-3.5 space-y-3">
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200">
                    <GitMerge size={14} className="text-indigo-500" />
                    多表关联与拼接
                  </h4>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setMergeMode('join')}
                      className={`rounded-lg border py-1.5 text-xs transition ${
                        mergeMode === 'join'
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/40 font-semibold text-indigo-700 dark:text-indigo-300'
                          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      横向关联 (JOIN)
                    </button>
                    <button
                      onClick={() => setMergeMode('union')}
                      className={`rounded-lg border py-1.5 text-xs transition ${
                        mergeMode === 'union'
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/40 font-semibold text-indigo-700 dark:text-indigo-300'
                          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      纵向拼接 (Union)
                    </button>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">选择要关联的目标文件</label>
                    <select
                      value={targetFileIdx}
                      onChange={(e) => {
                        setTargetFileIdx(Number(e.target.value));
                        setTargetSheetIdx(0);
                      }}
                      className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-xs text-gray-800 dark:text-gray-200 outline-none"
                    >
                      {files.map((f, i) => (
                        <option key={i} value={i}>
                          {f.fileName}
                        </option>
                      ))}
                    </select>
                  </div>

                  {targetFile && targetFile.sheets.length > 1 && (
                    <div>
                      <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">选择目标工作表</label>
                      <select
                        value={targetSheetIdx}
                        onChange={(e) => setTargetSheetIdx(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-xs text-gray-800 dark:text-gray-200 outline-none"
                      >
                        {targetFile.sheets.map((s, i) => (
                          <option key={i} value={i}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {mergeMode === 'join' ? (
                    <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-2.5">
                      <div>
                        <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">主表关联键 (当前表)</label>
                        <select
                          value={joinKeyA}
                          onChange={(e) => setJoinKeyA(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                        >
                          {workingSheet?.headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">副表关联键 (目标表)</label>
                        <select
                          value={joinKeyB}
                          onChange={(e) => setJoinKeyB(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                        >
                          {targetSheet?.headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] font-medium text-gray-500 dark:text-gray-400">关联方式</label>
                        <select
                          value={joinType}
                          onChange={(e) => setJoinType(e.target.value as 'left' | 'inner')}
                          className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-800 dark:text-gray-200 outline-none"
                        >
                          <option value="left">左外连接 (保留主表全部行)</option>
                          <option value="inner">内连接 (仅保留主副表均匹配的行)</option>
                        </select>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      纵向拼接将两张表的行直接上下串联，相同名称的列将自动对齐合并。
                    </p>
                  )}

                  <button
                    onClick={handleApplyMerge}
                    className="w-full rounded-lg bg-indigo-600 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700 active:scale-95"
                  >
                    执行多表合并
                  </button>
                </div>
              </div>
            )}

            {/* 7. Delete Columns Tab */}
            {activeTab === 'columns' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">勾选需要删除的字段列：</p>
                <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 p-2.5">
                  {workingSheet?.headers.map((h) => (
                    <label
                      key={h}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      <input
                        type="checkbox"
                        checked={selectedColsToDelete.includes(h)}
                        onChange={() => toggleDeleteCol(h)}
                        className="rounded border-gray-300 text-blue-600"
                      />
                      <span className={selectedColsToDelete.includes(h) ? 'text-red-500 line-through' : 'text-gray-700 dark:text-gray-300'}>
                        {h}
                      </span>
                    </label>
                  ))}
                </div>

                {selectedColsToDelete.length > 0 && (
                  <button
                    onClick={handleDeleteColumns}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-600 py-1.5 text-xs font-medium text-white transition hover:bg-red-700 active:scale-95"
                  >
                    <Trash2 size={13} /> 删除所选 {selectedColsToDelete.length} 列
                  </button>
                )}
              </div>
            )}
          </div>
          <StepsPanel
            steps={steps}
            carried={carried}
            onUndo={handleUndoStep}
            onSave={() => void handleSaveSteps()}
            onLoad={() => void handleLoadSteps()}
            onReplayCarried={() => {
              if (carried) replaySteps(carried.steps, `「${carried.from}」的步骤`);
              setCarried(null);
            }}
            onDismissCarried={() => setCarried(null)}
          />
        </div>

        {/* Right Preview Data Grid */}
        <div className="flex-1 overflow-hidden p-4">
          <div className="flex h-full flex-col rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800/80 shadow-sm overflow-hidden">
            {workingSheet ? (
              <DataTable sheetData={workingSheet} />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-gray-400">
                请先选择工作表
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating Notification Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-xs font-medium text-white shadow-xl">
          <CheckCircle size={15} className="text-emerald-400" />
          {toastMessage}
        </div>
      )}

      {/* Pivot Export Customization Modal */}
      <ExportModal
        isOpen={isPivotExportModalOpen}
        title={`导出透视表为 ${pivotExportFormat.toUpperCase()}`}
        defaultFileName={`透视分析_${pivotRow || '数据'}`}
        format={pivotExportFormat}
        isExporting={isPivotExporting}
        onClose={() => setIsPivotExportModalOpen(false)}
        onConfirm={handleConfirmExportPivot}
      />

      {/* Confirm Overwrite Modal */}
      {isConfirmOverwriteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            onClick={() => setIsConfirmOverwriteOpen(false)}
            className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-xs transition-opacity"
          />
          <div className="relative w-full max-w-sm rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#111827] p-5 shadow-2xl transition-all">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
              确认覆盖当前工作表？
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
              将使用当前的清洗、筛选或计算结果直接覆盖「{originalSheet?.name}」，此操作不可撤销。如需保留原数据，建议选择「另存为新工作表」。
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsConfirmOverwriteOpen(false)}
                className="rounded-xl border border-gray-200 dark:border-gray-700 px-3.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition active:scale-95"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmSaveOverwrite}
                className="rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-blue-500/20 hover:bg-blue-700 active:scale-95 transition"
              >
                确认覆盖
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProcessView;
