import React, { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import DataSourceView from './views/DataSourceView';
import ConvertView from './views/ConvertView';
import ChartView from './views/ChartView';
import ProcessView from './views/ProcessView';
import ReportView from './views/ReportView';
import GlobalToast from './components/GlobalToast';
import { useDataStore, applyThemeClass, getIsDark } from './store/useDataStore';

const App: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const theme = useDataStore((s) => s.theme);
  const isDark = getIsDark(theme);

  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  useEffect(() => {
    void useDataStore.getState().initWorkspace();
  }, []);

  return (
    <div
      className={`flex h-screen w-screen overflow-hidden transition-colors duration-200 ${
        isDark ? 'dark bg-[#0b0f19] text-gray-100' : 'bg-slate-50 text-gray-900'
      }`}
    >
      {/* Global Ergonomic Toast System */}
      <GlobalToast />

      {/* Sidebar */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((prev) => !prev)}
      />

      {/* Main Content */}
      <main className="flex-1 overflow-hidden bg-slate-50 dark:bg-[#0b0f19] text-gray-900 dark:text-gray-100 transition-colors duration-200">
        <Routes>
          <Route path="/" element={<DataSourceView />} />
          <Route path="/convert" element={<ConvertView />} />
          <Route path="/chart" element={<ChartView />} />
          <Route path="/process" element={<ProcessView />} />
          <Route path="/report" element={<ReportView />} />
        </Routes>
      </main>
    </div>
  );
};

export default App;
