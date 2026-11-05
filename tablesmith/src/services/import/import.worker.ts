/// <reference lib="webworker" />
import { ImportError, parseDesktopPayload, parseFileBytes, type DesktopPayload, type ImportResult } from './index';

export type WorkerRequest =
  | { id: number; kind: 'bytes'; fileName: string; bytes: ArrayBuffer }
  | { id: number; kind: 'payload'; fileName: string; payload: DesktopPayload };

export type WorkerResponse =
  | { id: number; ok: true; result: ImportResult }
  | { id: number; ok: false; message: string; userFacing: boolean };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    const result =
      req.kind === 'bytes'
        ? parseFileBytes(req.fileName, new Uint8Array(req.bytes))
        : parseDesktopPayload(req.fileName, req.payload);
    self.postMessage({ id: req.id, ok: true, result } satisfies WorkerResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ id: req.id, ok: false, message, userFacing: err instanceof ImportError } satisfies WorkerResponse);
  }
};
