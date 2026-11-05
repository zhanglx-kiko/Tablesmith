import React, { useState } from 'react';
import FormatConverter from '../components/FormatConverter';
import type { ConversionRecord } from '../components/FormatConverter';
import { CheckCircle2, XCircle } from 'lucide-react';

const ConvertView: React.FC = () => {
  const [history, setHistory] = useState<ConversionRecord[]>([]);

  const handleConvert = (record: ConversionRecord) => {
    setHistory((prev) => [record, ...prev]);
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6 bg-gray-50/50 dark:bg-gray-950/40">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">格式转换</h2>
      </div>

      <FormatConverter onConvert={handleConvert} />

      {/* Conversion History */}
      {history.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-xs">
          <h3 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-200">转换记录</h3>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {history.map((r, i) => (
              <li key={i} className="flex items-center gap-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                {r.success ? (
                  <CheckCircle2 size={14} className="text-emerald-500" />
                ) : (
                  <XCircle size={14} className="text-red-400" />
                )}
                <span className="font-medium text-gray-800 dark:text-gray-100">{r.source}</span>
                <span className="text-gray-400">→</span>
                <span className="rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 font-mono text-[11px] uppercase text-gray-700 dark:text-gray-300">
                  {r.target}
                </span>
                <span className="ml-auto text-gray-400">{r.time}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ConvertView;
