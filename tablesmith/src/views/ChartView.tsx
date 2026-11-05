import React, { useState } from 'react';
import { BarChart3, Database } from 'lucide-react';
import { useDataStore } from '../store/useDataStore';
import ChartPanel from '../components/ChartPanel';

const ChartView: React.FC = () => {
  const { files } = useDataStore();

  const [fileIdx, setFileIdx] = useState(0);
  const [sheetIdx, setSheetIdx] = useState(0);

  const activeFile = files[fileIdx] ?? null;
  const activeSheet = activeFile?.sheets[sheetIdx] ?? null;

  if (files.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400">
        <Database size={44} strokeWidth={1.2} />
        <p className="text-sm">请先导入数据文件后再创建图表</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6 bg-gray-50/50 dark:bg-gray-950/40">
      {/* Header */}
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">图表可视化</h2>
      </div>

      {/* File / Sheet Selectors */}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-xs">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
          数据文件
          <select
            value={fileIdx}
            onChange={(e) => {
              setFileIdx(Number(e.target.value));
              setSheetIdx(0);
            }}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-800 dark:text-gray-200 outline-none focus:border-blue-500"
          >
            {files.map((f, i) => (
              <option key={i} value={i}>
                {f.fileName}
              </option>
            ))}
          </select>
        </label>

        {activeFile && activeFile.sheets.length > 1 && (
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-gray-400">
            工作表
            <select
              value={sheetIdx}
              onChange={(e) => setSheetIdx(Number(e.target.value))}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-800 dark:text-gray-200 outline-none focus:border-blue-500"
            >
              {activeFile.sheets.map((s, i) => (
                <option key={i} value={i}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="ml-auto flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
          <BarChart3 size={14} />
          {activeSheet
            ? `${activeSheet.rows.length} 行 × ${activeSheet.headers.length} 列`
            : '无数据'}
        </div>
      </div>

      {/* Chart Panel */}
      <div className="flex-1 min-h-[400px]">
        {activeSheet ? (
          <ChartPanel sheetData={activeSheet} />
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm text-gray-400 shadow-xs">
            无可用数据
          </div>
        )}
      </div>
    </div>
  );
};

export default ChartView;
