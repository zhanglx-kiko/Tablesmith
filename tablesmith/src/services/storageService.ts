import type { FileData } from '../types';

const DB_NAME = 'TablesmithWorkspaceDB';
const DB_VERSION = 1;
const STORE_WORKSPACE = 'workspace';
const STORE_CACHE = 'file_cache';

interface WorkspacePayload {
  files: FileData[];
  activeFileIndex: number;
  activeSheetIndex: number;
  updatedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB is not supported in this environment'));
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_WORKSPACE)) {
        db.createObjectStore(STORE_WORKSPACE);
      }
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

/**
 * Persists the currently open files and active selection into IndexedDB
 */
export async function saveWorkspace(
  files: FileData[],
  activeFileIndex: number,
  activeSheetIndex: number,
): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_WORKSPACE, STORE_CACHE], 'readwrite');
      const wsStore = tx.objectStore(STORE_WORKSPACE);
      const cacheStore = tx.objectStore(STORE_CACHE);

      const payload: WorkspacePayload = {
        files,
        activeFileIndex,
        activeSheetIndex,
        updatedAt: Date.now(),
      };

      wsStore.put(payload, 'current_workspace');

      // Also cache individual files so if a user closes one, it can be re-opened from history
      for (const file of files) {
        cacheStore.put(file, file.fileName);
      }

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (err) {
    console.warn('[storageService] Failed to persist workspace to IndexedDB:', err);
  }
}

/**
 * Loads the last persisted unclosed workspace from IndexedDB
 */
export async function loadWorkspace(): Promise<{
  files: FileData[];
  activeFileIndex: number;
  activeSheetIndex: number;
} | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_WORKSPACE, 'readonly');
      const store = tx.objectStore(STORE_WORKSPACE);
      const request = store.get('current_workspace');

      request.onsuccess = () => {
        db.close();
        const result = request.result as WorkspacePayload | undefined;
        if (!result || !Array.isArray(result.files)) {
          return resolve(null);
        }
        resolve({
          files: result.files,
          activeFileIndex: typeof result.activeFileIndex === 'number' ? result.activeFileIndex : 0,
          activeSheetIndex: typeof result.activeSheetIndex === 'number' ? result.activeSheetIndex : 0,
        });
      };

      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (err) {
    console.warn('[storageService] Failed to load workspace from IndexedDB:', err);
    return null;
  }
}

/**
 * Clears the active workspace (e.g. when user explicitly closes all files)
 */
export async function clearWorkspace(): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_WORKSPACE, 'readwrite');
      const store = tx.objectStore(STORE_WORKSPACE);
      store.delete('current_workspace');

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (err) {
    console.warn('[storageService] Failed to clear workspace from IndexedDB:', err);
  }
}

/**
 * Retrieves a cached file by its filename (e.g. when user clicks an item in Recent History)
 */
export async function loadCachedFile(fileName: string): Promise<FileData | null> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CACHE, 'readonly');
      const store = tx.objectStore(STORE_CACHE);
      const request = store.get(fileName);

      request.onsuccess = () => {
        db.close();
        const result = request.result as FileData | undefined;
        resolve(result ?? null);
      };

      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (err) {
    console.warn('[storageService] Failed to load cached file from IndexedDB:', err);
    return null;
  }
}
