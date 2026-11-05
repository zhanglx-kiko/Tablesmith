import { useCallback, useEffect, useRef, useState } from 'react';
import { useDataStore } from '../store/useDataStore';
import {
  describeImportError,
  importFromClipboard,
  importPaths,
  onFileDrop,
  pickAndImportFiles,
  type ImportOutcome,
} from '../services/fileService';

export interface FileImportApi {
  /** Name of the file being parsed, or a placeholder while the picker is open. */
  busyLabel: string | null;
  /** True while files are dragged over the window. */
  isDragging: boolean;
  pickFiles: () => Promise<void>;
  pasteClipboard: () => Promise<void>;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * One import flow for every entry point (picker, window drop, clipboard): parses in a
 * worker, adds each successful file to the store, and reports failures and notices
 * through toasts. Pending parses are cancelled when the owning component unmounts.
 */
export function useFileImport(): FileImportApi {
  const addFile = useDataStore((s) => s.addFile);
  const showToast = useDataStore((s) => s.showToast);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const report = useCallback(
    (outcomes: ImportOutcome[]) => {
      for (const o of outcomes) {
        if (!o.ok) continue;
        addFile(o.result.file);
        const sheetCount = o.result.file.sheets.length;
        const rowCount = o.result.file.sheets.reduce((n, s) => n + s.rows.length, 0);
        const summary = `${sheetCount} 个工作表，共 ${rowCount.toLocaleString()} 行`;
        if (o.result.notices.length > 0) {
          showToast({
            type: 'info',
            title: `已导入 ${o.fileName}`,
            message: [summary, ...o.result.notices].join('\n'),
            duration: 9000,
          });
        } else if (outcomes.length > 1) {
          showToast({ type: 'success', title: `已导入 ${o.fileName}`, message: summary, duration: 3000 });
        }
      }
      for (const o of outcomes) {
        if (o.ok) continue;
        showToast({ type: 'error', title: `无法导入 ${o.fileName}`, message: o.message, duration: 0 });
      }
    },
    [addFile, showToast],
  );

  const runImport = useCallback(
    async (label: string, task: (signal: AbortSignal) => Promise<ImportOutcome[]>) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setBusyLabel(label);
      try {
        report(await task(controller.signal));
      } catch (err) {
        if (!isAbort(err)) {
          showToast({ type: 'error', title: '导入失败', message: describeImportError(err), duration: 0 });
        }
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          setBusyLabel(null);
        }
      }
    },
    [report, showToast],
  );

  const pickFiles = useCallback(() => runImport('正在读取文件…', (signal) => pickAndImportFiles(signal)), [runImport]);

  const pasteClipboard = useCallback(
    () =>
      runImport('正在读取剪贴板…', async () => {
        try {
          const result = await importFromClipboard();
          return [{ ok: true, fileName: result.file.fileName, result }];
        } catch (err) {
          return [{ ok: false, fileName: '剪贴板内容', message: describeImportError(err) }];
        }
      }),
    [runImport],
  );

  useEffect(
    () =>
      onFileDrop((event) => {
        if (event.type !== 'drop') {
          setIsDragging(event.type === 'over');
          return;
        }
        setIsDragging(false);
        const { paths } = event;
        if (paths.length === 0) return;
        const label = paths.length === 1 ? '正在解析拖入的文件…' : `正在解析 ${paths.length} 个文件…`;
        void runImport(label, (signal) => importPaths(paths, signal));
      }),
    [runImport],
  );

  return { busyLabel, isDragging, pickFiles, pasteClipboard };
}
