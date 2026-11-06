import { ImportError, type DesktopPayload, type ImportResult } from './index';
import type { WorkerRequest, WorkerResponse } from './import.worker';

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
type Pending = { resolve: (r: ImportResult) => void; reject: (e: Error) => void; cleanup: () => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(message: string): void {
  for (const p of pending.values()) {
    p.cleanup();
    p.reject(new Error(message));
  }
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const res = event.data;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    p.cleanup();
    if (res.ok) p.resolve(res.result);
    else p.reject(res.userFacing ? new ImportError(res.message) : new Error(res.message));
  };
  worker.onerror = (event) => {
    event.preventDefault();
    failAll(`解析进程异常：${event.message || '未知错误'}`);
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/**
 * Parse off the main thread so large workbooks never freeze the UI. Aborting rejects
 * the promise with an `AbortError`; the worker is recycled because SheetJS cannot be
 * interrupted mid-parse.
 */
function run(request: WithoutId<WorkerRequest>, signal?: AbortSignal, transfer: Transferable[] = []): Promise<ImportResult> {
  if (signal?.aborted) return Promise.reject(new DOMException('已取消', 'AbortError'));
  const id = nextId++;
  return new Promise<ImportResult>((resolve, reject) => {
    const onAbort = () => {
      pending.delete(id);
      reject(new DOMException('已取消', 'AbortError'));
      if (pending.size === 0 && worker) {
        worker.terminate();
        worker = null;
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(id, { resolve, reject, cleanup: () => signal?.removeEventListener('abort', onAbort) });
    getWorker().postMessage({ ...request, id } as WorkerRequest, transfer);
  });
}

export function parseBytesInWorker(fileName: string, bytes: ArrayBuffer, signal?: AbortSignal): Promise<ImportResult> {
  return run({ kind: 'bytes', fileName, bytes }, signal, [bytes]);
}

export function parsePayloadInWorker(fileName: string, payload: DesktopPayload, signal?: AbortSignal, bytes?: ArrayBuffer): Promise<ImportResult> {
  return run({ kind: 'payload', fileName, payload, bytes }, signal, bytes ? [bytes] : []);
}
