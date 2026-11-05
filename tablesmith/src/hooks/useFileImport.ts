import { useCallback, useEffect, useRef, useState } from 'react';
import { useDataStore } from '../store/useDataStore';
import {
  describeImportError,
  importBrowserFiles,
  importFromClipboard,
  importPaths,
  isTauriEnv,
  pickAndImportFiles,
  type ImportOutcome,
} from '../services/fileService';

export interface FileImportApi {
  /** Name of the file being parsed, or a placeholder while the picker is open. */
  busyLabel: string | null;
  pickFiles: () => Promise<void>;
  importDropped: (files: File[]) => Promise<void>;
  pasteClipboard: () => Promise<void>;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * One import flow for every entry point (picker, drag and drop, clipboard): parses in a
 * worker, adds each successful file to the store, and reports failures and notices
 * through toasts. Pending parses are cancelled when the owning component unmounts.
 */
export function useFileImport(): FileImportApi {
  const addFile = useDataStore((s) => s.addFile);
  const showToast = useDataStore((s) => s.showToast);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const report = useCallback(
    (outcomes: ImportOutcome[]) => {
      const failed = outcomes.filter((o) => !o.ok);
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
      for (const o of failed) {
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

  const importDropped = useCallback(
    (files: File[]) => {
      if (files.length === 0) return Promise.resolve();
      const label = files.length === 1 ? `正在解析 ${files[0].name}…` : `正在解析 ${files.length} 个文件…`;
      return runImport(label, (signal) => importBrowserFiles(files, signal));
    },
    [runImport],
  );

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

  // Desktop: Tauri intercepts native drops (dragDropEnabled), so HTML drop events never
  // fire there. Listen to the webview drag-drop event and import by path instead.
  useEffect(() => {
    if (!isTauriEnv()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void import('@tauri-apps/api/webview').then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type !== 'drop' || event.payload.paths.length === 0) return;
          const paths = event.payload.paths;
          const label = paths.length === 1 ? '正在解析拖入的文件…' : `正在解析 ${paths.length} 个文件…`;
          void runImport(label, (signal) => importPaths(paths, signal));
        })
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        }),
    );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [runImport]);

  return { busyLabel, pickFiles, importDropped, pasteClipboard };
}
