import React, { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridApi, GridReadyEvent } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { AG_GRID_LOCALE_CN } from '@ag-grid-community/locale';
import { FilterX, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import type { SheetData } from '../types';
import { useDataStore, getIsDark } from '../store/useDataStore';
import { compareCellsNumeric, parseNumericCell } from '../utils/numberUtils';
import { looksNumeric } from '../services/import/cellText';

ModuleRegistry.registerModules([AllCommunityModule]);

const LOCALE_TEXT: Record<string, string> = { ...AG_GRID_LOCALE_CN, resetFilter: '清空' };

/** A column is numeric when most of its non-empty cells parse as numbers. */
function isNumericColumn(rows: string[][], col: number): boolean {
  let filled = 0;
  let numeric = 0;
  for (const row of rows) {
    const v = row[col];
    if (v === undefined || v === '') continue;
    filled += 1;
    if (looksNumeric(v)) numeric += 1;
    if (filled >= 200) break;
  }
  return filled > 0 && numeric / filled >= 0.8;
}

interface DataTableProps {
  sheetData: SheetData;
}

const DataTable: React.FC<DataTableProps> = ({ sheetData }) => {
  const gridApiRef = useRef<GridApi | null>(null);
  const theme = useDataStore((s) => s.theme);
  const tableZoom = useDataStore((s) => s.tableZoom);
  const setTableZoom = useDataStore((s) => s.setTableZoom);
  const valueMode = useDataStore((s) => s.valueMode);
  const setValueMode = useDataStore((s) => s.setValueMode);
  const isDark = getIsDark(theme);
  /** Rows left after column filters; null when no filter is active. */
  const [filteredCount, setFilteredCount] = useState<number | null>(null);
  const gridThemeClass = isDark ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

  const zoomRatio = tableZoom / 100;
  const fontSize = Math.round(13 * zoomRatio);
  const rowHeight = Math.round(36 * zoomRatio);
  const headerHeight = Math.round(40 * zoomRatio);

  useEffect(() => {
    if (gridApiRef.current) {
      gridApiRef.current.resetRowHeights();
      gridApiRef.current.refreshHeader();
    }
  }, [tableZoom]);

  const hasDisplay = Boolean(sheetData.display);
  const showExcel = valueMode === 'excel' && hasDisplay;

  const columnDefs = useMemo<ColDef[]>(
    () =>
      sheetData.headers.map((header, i) => {
        const numeric = isNumericColumn(sheetData.rows, i);
        // `r${i}` is the raw value, `d${i}` Excel's text (empty when identical to raw).
        // Keyed by index: AG Grid reads dots in `field` as nested paths ("address.city").
        const shown = (data: Record<string, string> | undefined): string => {
          if (!data) return '';
          const raw = data[`r${i}`] ?? '';
          return showExcel ? data[`d${i}`] || raw : raw;
        };
        return {
          colId: `c${i}`,
          headerName: header,
          valueGetter: (p) => shown(p.data),
          // Hover shows the other form when it differs.
          tooltipValueGetter: (p) => {
            const data = p.data as Record<string, string> | undefined;
            const disp = data?.[`d${i}`];
            if (!data || !disp) return undefined;
            return showExcel ? `原始值：${data[`r${i}`] ?? ''}` : `Excel 显示：${disp}`;
          },
          // Right-align numeric cells only; the `rightAligned` type would also flip the header
          // and move the filter button to the left.
          cellClass: numeric ? 'ag-right-aligned-cell' : undefined,
          // Sorting always uses the raw value, never the formatted text.
          comparator: (_a, _b, nodeA, nodeB) =>
            compareCellsNumeric(nodeA.data?.[`r${i}`] ?? '', nodeB.data?.[`r${i}`] ?? ''),
          // Numeric columns compare raw numbers (> 0.6 matches 61.4%); text columns match
          // the text on screen, like Excel's AutoFilter.
          ...(numeric
            ? {
                filter: 'agNumberColumnFilter',
                filterValueGetter: (p: { data?: Record<string, string> }) => {
                  const n = parseNumericCell(p.data?.[`r${i}`] ?? '');
                  return Number.isNaN(n) ? null : n;
                },
              }
            : { filter: 'agTextColumnFilter' }),
          sortable: true,
          resizable: true,
          minWidth: 105,
        } satisfies ColDef;
      }),
    [sheetData.headers, sheetData.rows, showExcel],
  );

  const rowData = useMemo(
    () =>
      sheetData.rows.map((row, idx) => {
        const obj: Record<string, string> = { __rowId: `row_${idx}` };
        const disp = sheetData.display?.[idx];
        sheetData.headers.forEach((_, i) => {
          obj[`r${i}`] = row[i] ?? '';
          const d = disp?.[i];
          if (d) obj[`d${i}`] = d;
        });
        return obj;
      }),
    [sheetData],
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      minWidth: 105,
      sortable: true,
      filter: true,
      // "清空" in every column filter popup; changes still apply while typing.
      filterParams: { buttons: ['reset'] },
      resizable: true,
    }),
    [],
  );

  const autoSizeStrategy = useMemo(() => {
    if (sheetData.headers.length <= 6) {
      return { type: 'fitGridWidth' as const, defaultMinWidth: 120 };
    }
    return { type: 'fitCellContents' as const, defaultMinWidth: 105 };
  }, [sheetData.headers.length]);

  const handleGridReady = useCallback((params: GridReadyEvent) => {
    gridApiRef.current = params.api;
  }, []);

  const handleFilterChanged = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) return;
    setFilteredCount(api.isAnyFilterPresent() ? api.getDisplayedRowCount() : null);
  }, []);

  const handleClearFilters = useCallback(() => {
    gridApiRef.current?.setFilterModel(null);
  }, []);

  // A new sheet starts unfiltered.
  useEffect(() => setFilteredCount(null), [sheetData]);

  const handleFitContents = useCallback(() => {
    gridApiRef.current?.autoSizeAllColumns();
  }, []);

  const handleFitGridWidth = useCallback(() => {
    gridApiRef.current?.sizeColumnsToFit();
  }, []);

  const handleZoomIn = useCallback(() => {
    setTableZoom(tableZoom + 10);
  }, [tableZoom, setTableZoom]);

  const handleZoomOut = useCallback(() => {
    setTableZoom(tableZoom - 10);
  }, [tableZoom, setTableZoom]);

  const handleResetZoom = useCallback(() => {
    setTableZoom(100);
  }, [setTableZoom]);

  return (
    <div className="flex flex-col h-full">
      <div
        className={`${gridThemeClass} flex-1 w-full h-full`}
        style={
          {
            '--ag-font-size': `${fontSize}px`,
            '--ag-row-height': `${rowHeight}px`,
            '--ag-header-height': `${headerHeight}px`,
          } as React.CSSProperties
        }
      >
        <AgGridReact
          columnDefs={columnDefs}
          rowData={rowData}
          defaultColDef={defaultColDef}
          autoSizeStrategy={autoSizeStrategy}
          getRowId={(params) => params.data.__rowId}
          // Styling is built on the v32 CSS file themes (ag-theme-alpine + --ag-* in index.css).
          theme="legacy"
          localeText={LOCALE_TEXT}
          onGridReady={handleGridReady}
          onFilterChanged={handleFilterChanged}
          tooltipShowDelay={400}
          tooltipInteraction
          animateRows
          suppressCellFocus
          domLayout="normal"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between border-t border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-900/70 px-4 py-1.5 text-xs text-gray-500 dark:text-gray-400 gap-y-1">
        <div className="flex items-center gap-3">
          {filteredCount === null ? (
            <span>
              共 <strong className="text-gray-700 dark:text-gray-200">{sheetData.rows.length}</strong> 行 ×{' '}
              <strong className="text-gray-700 dark:text-gray-200">{sheetData.headers.length}</strong> 列
            </span>
          ) : (
            <span className="flex items-center gap-2" data-testid="filter-status">
              <span>
                已筛选 <strong className="text-blue-600 dark:text-blue-400">{filteredCount}</strong> /{' '}
                {sheetData.rows.length} 行
              </span>
              <button
                type="button"
                onClick={handleClearFilters}
                className="flex items-center gap-1 rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition cursor-pointer"
              >
                <FilterX size={11} />
                清除全部筛选
              </button>
            </span>
          )}
          <span className="text-gray-300 dark:text-gray-700">|</span>
          <span className="hidden md:inline text-[11px] text-gray-400 dark:text-gray-500" data-testid="value-semantics">
            {hasDisplay ? '排序、数值筛选和计算按原始值；文本筛选按单元格显示的文字' : '支持拖拽/双击列边界微调列宽'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {hasDisplay && (
            <div
              role="group"
              aria-label="单元格显示方式"
              data-testid="value-mode"
              className="flex items-center rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 shadow-2xs"
            >
              {(
                [
                  ['excel', 'Excel 格式', '按 Excel 中的格式显示（如 $28,975,558、61.4%），悬停查看原始值'],
                  ['raw', '原始值', '显示文件里存的原始值，悬停查看 Excel 格式'],
                ] as const
              ).map(([mode, label, hint]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={valueMode === mode}
                  onClick={() => setValueMode(mode)}
                  title={hint}
                  className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                    valueMode === mode
                      ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-semibold'
                      : 'hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* 单元格缩放控制 */}
          <div className="flex items-center rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5 shadow-2xs">
            <button
              onClick={handleZoomOut}
              disabled={tableZoom <= 70}
              className="p-1 rounded text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
              title="缩小单元格与文字 (最小 70%)"
              aria-label="缩小单元格"
            >
              <ZoomOut size={12} />
            </button>
            <button
              onClick={handleResetZoom}
              className="px-1.5 text-[11px] font-semibold text-gray-700 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 transition cursor-pointer"
              title="点击恢复 100% 原始缩放"
            >
              {tableZoom}%
            </button>
            <button
              onClick={handleZoomIn}
              disabled={tableZoom >= 160}
              className="p-1 rounded text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
              title="放大单元格与文字 (最大 160%)"
              aria-label="放大单元格"
            >
              <ZoomIn size={12} />
            </button>
          </div>

          {/* 密度快捷切换 */}
          <div className="hidden sm:flex items-center rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 shadow-2xs">
            <button
              onClick={() => setTableZoom(85)}
              className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                tableZoom === 85
                  ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'hover:text-gray-700 dark:hover:text-gray-200'
              }`}
              title="紧凑密度 (85%)"
            >
              紧凑
            </button>
            <button
              onClick={() => setTableZoom(100)}
              className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                tableZoom === 100
                  ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'hover:text-gray-700 dark:hover:text-gray-200'
              }`}
              title="标准密度 (100%)"
            >
              标准
            </button>
            <button
              onClick={() => setTableZoom(120)}
              className={`px-1.5 py-0.5 rounded transition cursor-pointer ${
                tableZoom === 120
                  ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'hover:text-gray-700 dark:hover:text-gray-200'
              }`}
              title="宽松放大 (120%)"
            >
              宽松
            </button>
          </div>

          <span className="text-gray-300 dark:text-gray-700">|</span>

          {/* 列宽自适应与平铺 */}
          <button
            onClick={handleFitContents}
            className="flex items-center gap-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition shadow-2xs cursor-pointer active:scale-95"
            title="根据单元格内容自适应全部列宽"
          >
            <Maximize2 size={11} />
            自适应列宽
          </button>
          <button
            onClick={handleFitGridWidth}
            className="flex items-center gap-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition shadow-2xs cursor-pointer active:scale-95"
            title="将所有列平铺撑满当前表格视口"
          >
            <Minimize2 size={11} />
            平铺撑满
          </button>
          <span className="text-gray-300 dark:text-gray-700">|</span>
          <span className="font-medium text-gray-600 dark:text-gray-300">{sheetData.name}</span>
        </div>
      </div>
    </div>
  );
};

export default DataTable;
