import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Database,
  ArrowLeftRight,
  BarChart3,
  Settings2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileJson,
  FileCode,
  FileText,
  X,
  BarChart2,
  History,
  Trash,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { useDataStore } from '../store/useDataStore';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const NAV_ITEMS = [
  { to: '/', label: '数据源', Icon: Database },
  { to: '/convert', label: '格式转换', Icon: ArrowLeftRight },
  { to: '/chart', label: '图表可视化', Icon: BarChart3 },
  { to: '/process', label: '数据处理', Icon: Settings2 },
  { to: '/report', label: '报表生成', Icon: FileText },
];

function fileIcon(type: string) {
  switch (type) {
    case 'xlsx':
    case 'xls':
      return <FileSpreadsheet size={14} className="text-emerald-500" />;
    case 'json':
      return <FileJson size={14} className="text-amber-500" />;
    case 'xml':
      return <FileCode size={14} className="text-sky-500" />;
    case 'xsd':
      return <FileCode size={14} className="text-pink-500" />;
    case 'csv':
      return <FileText size={14} className="text-violet-500" />;
    default:
      return <FileText size={14} className="text-gray-400" />;
  }
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggle }) => {
  const location = useLocation();
  const {
    files,
    activeFileIndex,
    setActiveFile,
    removeFile,
    recentHistory,
    clearRecentHistory,
    theme,
    setTheme,
    reopenFromHistory,
    showToast,
  } = useDataStore();

  const handleRecentClick = async (fileName: string) => {
    const success = await reopenFromHistory(fileName);
    if (!success) {
      showToast({
        type: 'info',
        title: '该历史文件未在本地缓存',
        message: '请点击“导入新文件”重新打开此文件',
      });
    }
  };

  return (
    <aside
      className={`relative flex flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0e1422]
        transition-[width] duration-200 ${collapsed ? 'w-[56px]' : 'w-[220px]'} shrink-0 select-none`}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-gray-200/60 dark:border-gray-800">
        <BarChart2 size={22} className="text-blue-600 dark:text-blue-400 shrink-0" />
        {!collapsed && (
          <span className="text-[15px] font-semibold tracking-tight text-gray-800 dark:text-gray-100">
            表匠
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-0.5 px-2 py-3">
        {NAV_ITEMS.map(({ to, label, Icon }) => {
          const active =
            to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
          return (
            <NavLink
              key={to}
              to={to}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors
                ${
                  active
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
            >
              <Icon size={17} className="shrink-0" />
              {!collapsed && <span>{label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Loaded Files */}
      {!collapsed && files.length > 0 && (
        <div className="flex-1 overflow-y-auto px-2 pb-3 border-t border-gray-100 dark:border-gray-800">
          <p className="px-2.5 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            当前打开 ({files.length})
          </p>
          <ul className="flex flex-col gap-0.5">
            {files.map((f, idx) => (
              <li
                key={idx}
                onClick={() => setActiveFile(idx)}
                className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors
                  ${
                    idx === activeFileIndex
                      ? 'bg-blue-50/70 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
              >
                {fileIcon(f.fileType)}
                <span className="flex-1 truncate">{f.fileName}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(idx);
                  }}
                  className="hidden rounded p-0.5 text-gray-400 hover:text-red-500 group-hover:block"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recent History */}
      {!collapsed && recentHistory.length > 0 && (
        <div className="max-h-40 overflow-y-auto px-2 py-2 border-t border-gray-200/60 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          <div className="flex items-center justify-between px-2 pb-1">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 dark:text-gray-500">
              <History size={11} />
              最近历史
            </span>
            <button
              onClick={clearRecentHistory}
              title="清空历史记录"
              className="text-[10px] text-gray-400 hover:text-red-500 p-0.5"
            >
              <Trash size={11} />
            </button>
          </div>
          <ul className="flex flex-col gap-0.5">
            {recentHistory.slice(0, 5).map((item) => (
              <li
                key={item.id}
                onClick={() => void handleRecentClick(item.fileName)}
                title={`点击重新打开: ${item.fileName}`}
                className="flex cursor-pointer items-center justify-between px-2 py-1 text-[11.5px] text-gray-500 dark:text-gray-400 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <span className="truncate max-w-[130px] hover:text-blue-600 dark:hover:text-blue-400">
                  {item.fileName}
                </span>
                <span className="text-[10px] text-gray-400 shrink-0">{item.timestamp}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Spacer to push controls to bottom if file list is short */}
      <div className="flex-1 min-h-4" />

      {/* Theme Switcher — Minimalist Icon-only Segmented Control */}
      <div className="p-2 border-t border-gray-200/60 dark:border-gray-800">
        {!collapsed ? (
          <div className="flex items-center rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5 border border-gray-200/50 dark:border-gray-700/50">
            <button
              type="button"
              onClick={() => setTheme('light')}
              title="浅色模式"
              className={`flex-1 flex items-center justify-center py-1.5 rounded-md transition-all ${
                theme === 'light'
                  ? 'bg-white text-amber-500 shadow-xs font-medium'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
              }`}
            >
              <Sun size={15} />
            </button>
            <button
              type="button"
              onClick={() => setTheme('dark')}
              title="深色模式"
              className={`flex-1 flex items-center justify-center py-1.5 rounded-md transition-all ${
                theme === 'dark'
                  ? 'bg-gray-900 text-blue-400 shadow-xs font-medium'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
              }`}
            >
              <Moon size={15} />
            </button>
            <button
              type="button"
              onClick={() => setTheme('system')}
              title="跟随系统"
              className={`flex-1 flex items-center justify-center py-1.5 rounded-md transition-all ${
                theme === 'system'
                  ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-xs font-medium'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'
              }`}
            >
              <Monitor size={15} />
            </button>
          </div>
        ) : (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => {
                const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
                setTheme(next);
              }}
              title={`当前模式: ${theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统'}`}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800 transition"
            >
              {theme === 'light' ? (
                <Sun size={16} className="text-amber-500" />
              ) : theme === 'dark' ? (
                <Moon size={16} className="text-blue-400" />
              ) : (
                <Monitor size={16} className="text-emerald-500" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* Collapse Toggle */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-5 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-400 shadow-sm transition hover:text-gray-600"
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
      </button>
    </aside>
  );
};

export default Sidebar;
