import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';

interface ImportNotesProps {
  notes: string[];
}

/** Collapsible list of what the importer skipped or converted for the active file. */
const ImportNotes: React.FC<ImportNotesProps> = ({ notes }) => {
  const [open, setOpen] = useState(false);
  if (notes.length === 0) return null;

  return (
    <div
      data-testid="import-notes"
      className="border-b border-gray-200 dark:border-gray-800 bg-blue-50/50 dark:bg-blue-950/20 px-4 text-xs text-gray-600 dark:text-gray-300"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 py-1.5 text-left hover:text-gray-900 dark:hover:text-gray-100"
      >
        <Info size={13} className="shrink-0 text-blue-500" />
        <span>导入说明（{notes.length} 条）</span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <ul className="list-disc space-y-1 pb-2 pl-8">
          {notes.map((note, i) => (
            <li key={i} className="break-words">
              {note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ImportNotes;
