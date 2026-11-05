import React from 'react';
import { FileCode, FileJson, FileSpreadsheet, FileText } from 'lucide-react';

interface FileTypeIconProps {
  type: string;
  size?: number;
}

const FileTypeIcon: React.FC<FileTypeIconProps> = ({ type, size = 14 }) => {
  switch (type) {
    case 'xlsx':
    case 'xlsm':
    case 'xlsb':
    case 'xls':
    case 'ods':
      return <FileSpreadsheet size={size} className="text-emerald-500 shrink-0" />;
    case 'json':
    case 'jsonl':
    case 'ndjson':
      return <FileJson size={size} className="text-amber-500 shrink-0" />;
    case 'xml':
      return <FileCode size={size} className="text-sky-500 shrink-0" />;
    case 'xsd':
      return <FileCode size={size} className="text-pink-500 shrink-0" />;
    case 'csv':
    case 'tsv':
    case 'txt':
      return <FileText size={size} className="text-violet-500 shrink-0" />;
    default:
      return <FileText size={size} className="text-gray-400 shrink-0" />;
  }
};

export default FileTypeIcon;
