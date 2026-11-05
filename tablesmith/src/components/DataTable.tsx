import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, GridApi, GridReadyEvent } from 'ag-grid-community';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import type { SheetData } from '../types';
import { useDataStore, getIsDark } from '../store/useDataStore';
import { compareCellsNumeric } from '../utils/numberUtils';

ModuleRegistry.registerModules([AllCommunityModule]);

interface DataTableProps {
  sheetData: SheetData;
}

const DataTable: React.FC<DataTableProps> = ({ sheetData }) => {
  const gridApiRef = useRef<GridApi | null>(null);
  const theme = useDataStore((s) => s.theme);
  const tableZoom = useDataStore((s) => s.tableZoom);
  const setTableZoom = useDataStore((s) => s.setTableZoom);
  const isDark = getIsDark(theme);
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

  const columnDefs = useMemo<ColDef[]>(
    () =>
      sheetData.headers.map((header, i) => ({
        // Keyed by index: AG Grid reads dots in `field` as nested paths ("address.city").
        field: `c${i}`,
        headerName: header,
        sortable: true,
        filter: true,
        resizable: true,
        minWidth: 105,
        comparator: compareCellsNumeric,
      })),
    [sheetData.headers],
  );

  const rowData = useMemo(
    () =>
      sheetData.rows.map((row, idx) => {
        const obj: Record<string, string> = { __rowId: `row_${idx}` };
        sheetData.headers.forEach((_, i) => {
          obj[`c${i}`] = row[i] ?? '';
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
          onGridReady={handleGridReady}
          animateRows
          suppressCellFocus
          domLayout="normal"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between border-t border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-900/70 px-4 py-1.5 text-xs text-gray-500 dark:text-gray-400 gap-y-1">
        <div className="flex items-center gap-3">
          <span>
            共 <strong className="text-gray-700 dark:text-gray-200">{sheetData.rows.length}</strong> 行 ×{' '}
            <strong className="text-gray-700 dark:text-gray-200">{sheetData.headers.length}</strong> 列
          </span>
          <span className="text-gray-300 dark:text-gray-700">|</span>
          <span className="hidden md:inline text-[11px] text-gray-400 dark:text-gray-500">
            支持拖拽/双击列边界微调列宽
          </span>
        </div>

        <div className="flex items-center gap-2">
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
