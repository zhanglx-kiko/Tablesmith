import type { SheetData } from '../types';
import {
  addComputedColumn,
  deleteColumns,
  filterRows,
  maskColumnData,
  removeDuplicates,
  removeEmptyRows,
  trimWhitespace,
  type ComputedColumnConfig,
  type FilterCondition,
  type MaskType,
} from './dataProcessService';
import { generatePivotTable, type PivotConfig } from './pivotTableService';

/**
 * Processing steps as data, so a sequence applied to one sheet can be saved and replayed
 * on another with the same columns (next month's export, another region's file). Steps
 * name columns by header text; replay checks every column exists before changing
 * anything. Join/union read a second table and are not recorded (the other table is not
 * part of the recipe). See docs/recipes.md.
 */
export type RecipeStep =
  | { op: 'dedupe'; columns?: string[] }
  | { op: 'removeEmptyRows' }
  | { op: 'trim' }
  | { op: 'filter'; conditions: Omit<FilterCondition, 'id'>[]; match: 'all' | 'any' }
  | { op: 'compute'; config: ComputedColumnConfig }
  | { op: 'deleteColumns'; columns: string[] }
  | { op: 'mask'; column: string; type: MaskType }
  | { op: 'pivot'; config: PivotConfig };

export interface Recipe {
  /** Format version; bump when a step's meaning changes. */
  version: 1;
  name: string;
  /** Headers of the sheet the recipe was recorded on, shown when replay finds a mismatch. */
  sourceHeaders: string[];
  steps: RecipeStep[];
}

export interface StepResult {
  step: RecipeStep;
  rowsBefore: number;
  rowsAfter: number;
  columnsAfter: number;
  /** The table after this step, so the UI can undo one step at a time. */
  sheet: SheetData;
}

export class RecipeError extends Error {
  constructor(
    message: string,
    /** 0-based index of the step that could not run. */
    readonly stepIndex: number,
  ) {
    super(message);
    this.name = 'RecipeError';
  }
}

/** Columns a step reads; replay requires them to exist when the step runs. */
export function stepColumns(step: RecipeStep): string[] {
  switch (step.op) {
    case 'dedupe':
      return step.columns ?? [];
    case 'filter':
      return step.conditions.map((c) => c.column);
    case 'compute':
      return [step.config.colA, ...(step.config.type === 'prefixSuffix' ? [] : [step.config.colB ?? ''])].filter(Boolean);
    case 'deleteColumns':
      return step.columns;
    case 'mask':
      return [step.column];
    case 'pivot': {
      const c = step.config;
      return [c.rowField, c.subRowField, c.colField, c.valueField, c.filterField].filter((x): x is string => Boolean(x));
    }
    default:
      return [];
  }
}

/** One-line description of a step, as shown in the step list. */
export function describeStep(step: RecipeStep): string {
  switch (step.op) {
    case 'dedupe':
      return step.columns?.length ? `按「${step.columns.join('、')}」去重` : '去除完全相同的行';
    case 'removeEmptyRows':
      return '删除空行';
    case 'trim':
      return '去除首尾空格';
    case 'filter': {
      const join = step.match === 'all' ? ' 且 ' : ' 或 ';
      return `筛选：${step.conditions.map((c) => `「${c.column}」${OPERATOR_LABEL[c.operator]}${NO_VALUE.has(c.operator) ? '' : ` ${c.value}`}`).join(join)}`;
    }
    case 'compute': {
      const c = step.config;
      if (c.type === 'calc') return `新增列「${c.name}」=「${c.colA}」${c.operator}「${c.colB}」`;
      if (c.type === 'combine') return `新增列「${c.name}」= 合并「${c.colA}」「${c.colB}」`;
      return `新增列「${c.name}」= 「${c.colA}」加前后缀`;
    }
    case 'deleteColumns':
      return `删除列「${step.columns.join('、')}」`;
    case 'mask':
      return `脱敏「${step.column}」`;
    case 'pivot':
      return `透视：行「${step.config.rowField}」，值「${step.config.valueField}」`;
  }
}

const OPERATOR_LABEL: Record<FilterCondition['operator'], string> = {
  equals: '等于',
  notEquals: '不等于',
  contains: '包含',
  notContains: '不包含',
  greaterThan: '大于',
  lessThan: '小于',
  greaterThanOrEqual: '大于等于',
  lessThanOrEqual: '小于等于',
  isEmpty: '为空',
  isNotEmpty: '不为空',
};
const NO_VALUE = new Set<FilterCondition['operator']>(['isEmpty', 'isNotEmpty']);

/** Run one step. Pure: returns a new sheet and never mutates the input. */
export function applyStep(sheet: SheetData, step: RecipeStep): SheetData {
  switch (step.op) {
    case 'dedupe':
      return removeDuplicates(sheet, step.columns).result;
    case 'removeEmptyRows':
      return removeEmptyRows(sheet).result;
    case 'trim':
      return trimWhitespace(sheet);
    case 'filter':
      return filterRows(
        sheet,
        step.conditions.map((c, i) => ({ ...c, id: String(i) })),
        step.match,
      ).result;
    case 'compute':
      return addComputedColumn(sheet, step.config);
    case 'deleteColumns':
      return deleteColumns(sheet, step.columns);
    case 'mask':
      return maskColumnData(sheet, step.column, step.type).result;
    case 'pivot':
      return generatePivotTable(sheet, step.config);
  }
}

/**
 * Columns each step needs that will not exist when it runs, simulated on headers alone
 * (no data is processed). Empty when the recipe can run on a sheet with these headers.
 */
export function missingColumns(headers: string[], steps: RecipeStep[]): { stepIndex: number; columns: string[] }[] {
  let current = [...headers];
  const out: { stepIndex: number; columns: string[] }[] = [];
  steps.forEach((step, i) => {
    const missing = stepColumns(step).filter((c) => !current.includes(c));
    if (missing.length) out.push({ stepIndex: i, columns: [...new Set(missing)] });
    if (step.op === 'compute' && !current.includes(step.config.name)) current = [...current, step.config.name];
    if (step.op === 'deleteColumns') current = current.filter((h) => !step.columns.includes(h));
    if (step.op === 'pivot') current = []; // pivot output headers depend on the data
  });
  return out;
}

/**
 * Replay a recipe. Checks every column first, so a recipe that cannot run fully leaves
 * nothing half-done; then runs the steps in order and reports rows before / after each.
 */
export function runRecipe(sheet: SheetData, steps: RecipeStep[]): { result: SheetData; log: StepResult[] } {
  // Pivot output columns are only known after running; check up to the first pivot.
  const pivotAt = steps.findIndex((s) => s.op === 'pivot');
  const checked = pivotAt < 0 ? steps : steps.slice(0, pivotAt + 1);
  const missing = missingColumns(sheet.headers, checked);
  if (missing.length) {
    const m = missing[0];
    throw new RecipeError(`第 ${m.stepIndex + 1} 步（${describeStep(steps[m.stepIndex])}）需要的列不存在：${m.columns.map((c) => `「${c}」`).join('、')}`, m.stepIndex);
  }
  let current = sheet;
  const log: StepResult[] = [];
  steps.forEach((step, i) => {
    const absent = stepColumns(step).filter((c) => !current.headers.includes(c));
    if (absent.length) {
      throw new RecipeError(`第 ${i + 1} 步（${describeStep(step)}）需要的列不存在：${absent.map((c) => `「${c}」`).join('、')}`, i);
    }
    const before = current.rows.length;
    current = applyStep(current, step);
    log.push({ step, rowsBefore: before, rowsAfter: current.rows.length, columnsAfter: current.headers.length, sheet: current });
  });
  return { result: current, log };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const OPS = new Set(['dedupe', 'removeEmptyRows', 'trim', 'filter', 'compute', 'deleteColumns', 'mask', 'pivot']);
const MASKS = new Set(['phone', 'idcard', 'name', 'email', 'all']);

/** Parse a recipe file; any shape problem is a RecipeError with a user-facing message. */
export function parseRecipe(text: string): Recipe {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new RecipeError('不是有效的处理步骤文件（JSON 格式错误）', -1);
  }
  if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.steps)) {
    throw new RecipeError('不是表匠的处理步骤文件，或版本不受支持', -1);
  }
  const steps = data.steps.map((s, i): RecipeStep => {
    const bad = () => new RecipeError(`第 ${i + 1} 步的内容无法识别`, i);
    if (!isRecord(s) || typeof s.op !== 'string' || !OPS.has(s.op)) throw bad();
    switch (s.op) {
      case 'dedupe':
        if (s.columns !== undefined && !isStringArray(s.columns)) throw bad();
        return s.columns ? { op: 'dedupe', columns: s.columns } : { op: 'dedupe' };
      case 'removeEmptyRows':
      case 'trim':
        return { op: s.op };
      case 'filter':
        if (!Array.isArray(s.conditions) || (s.match !== 'all' && s.match !== 'any')) throw bad();
        return {
          op: 'filter',
          match: s.match,
          conditions: s.conditions.map((c) => {
            if (!isRecord(c) || typeof c.column !== 'string' || typeof c.value !== 'string' || typeof c.operator !== 'string' || !(c.operator in OPERATOR_LABEL)) throw bad();
            return { column: c.column, operator: c.operator as FilterCondition['operator'], value: c.value };
          }),
        };
      case 'compute':
        if (!isRecord(s.config) || typeof s.config.name !== 'string' || typeof s.config.colA !== 'string') throw bad();
        if (s.config.type !== 'calc' && s.config.type !== 'combine' && s.config.type !== 'prefixSuffix') throw bad();
        return { op: 'compute', config: s.config as unknown as ComputedColumnConfig };
      case 'deleteColumns':
        if (!isStringArray(s.columns)) throw bad();
        return { op: 'deleteColumns', columns: s.columns };
      case 'mask':
        if (typeof s.column !== 'string' || typeof s.type !== 'string' || !MASKS.has(s.type)) throw bad();
        return { op: 'mask', column: s.column, type: s.type as MaskType };
      case 'pivot':
        if (!isRecord(s.config) || typeof s.config.rowField !== 'string' || typeof s.config.valueField !== 'string' || typeof s.config.aggType !== 'string') throw bad();
        return { op: 'pivot', config: s.config as unknown as PivotConfig };
      default:
        throw bad();
    }
  });
  return {
    version: 1,
    name: typeof data.name === 'string' ? data.name : '处理步骤',
    sourceHeaders: isStringArray(data.sourceHeaders) ? data.sourceHeaders : [],
    steps,
  };
}

export function serializeRecipe(recipe: Recipe): string {
  return `${JSON.stringify(recipe, null, 2)}\n`;
}
