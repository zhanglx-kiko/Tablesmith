import { create } from 'zustand';
import type { FileData, SheetData } from '../types';
import {
  saveWorkspace,
  loadWorkspace,
  clearWorkspace,
  loadCachedFile,
} from '../services/storageService';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface RecentHistoryItem {
  id: string;
  fileName: string;
  fileType: string;
  rowCount: number;
  colCount: number;
  timestamp: string;
}

const RECENT_HISTORY_KEY = 'tablesmith_recent_history';
const THEME_KEY = 'tablesmith_theme_mode';
const TABLE_ZOOM_KEY = 'tablesmith_table_zoom';

function loadInitialTableZoom(): number {
  try {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(TABLE_ZOOM_KEY) : null;
    const num = stored ? Number(stored) : 100;
    return num >= 70 && num <= 160 ? num : 100;
  } catch {
    return 100;
  }
}

export function getIsDark(theme: ThemeMode): boolean {
  if (typeof window === 'undefined') return false;
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function applyThemeClass(theme: ThemeMode): void {
  if (typeof window === 'undefined') return;
  const isDark = getIsDark(theme);
  if (isDark) {
    document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-theme', 'dark');
    document.body?.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
    document.documentElement.setAttribute('data-theme', 'light');
    document.body?.classList.remove('dark');
  }
}

function loadInitialTheme(): ThemeMode {
  try {
    const stored = typeof window !== 'undefined' ? (localStorage.getItem(THEME_KEY) as ThemeMode) : null;
    const theme: ThemeMode = stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system';
    applyThemeClass(theme);
    return theme;
  } catch {
    return 'system';
  }
}

// Listen to OS system color scheme changes in real-time
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    try {
      const state = useDataStore.getState();
      if (state.theme === 'system') {
        applyThemeClass('system');
      }
    } catch {
      // ignore
    }
  });
}

function loadInitialHistory(): RecentHistoryItem[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(RECENT_HISTORY_KEY) : null;
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistHistory(history: RecentHistoryItem[]): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(RECENT_HISTORY_KEY, JSON.stringify(history.slice(0, 25)));
    }
  } catch {
    // ignore storage quota errors
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersistWorkspace(
  files: FileData[],
  activeFileIndex: number,
  activeSheetIndex: number,
): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (files.length === 0) {
      void clearWorkspace();
    } else {
      void saveWorkspace(files, activeFileIndex, activeSheetIndex);
    }
  }, 250);
}

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message?: string;
  path?: string;
  duration?: number;
}

interface DataStoreState {
  files: FileData[];
  activeFileIndex: number;
  activeSheetIndex: number;
  recentHistory: RecentHistoryItem[];
  theme: ThemeMode;
  toasts: ToastItem[];
  tableZoom: number;
  isInitialized: boolean;

  initWorkspace: () => Promise<void>;
  reopenFromHistory: (fileName: string) => Promise<boolean>;

  addFile: (file: FileData) => void;
  removeFile: (index: number) => void;
  setActiveFile: (index: number) => void;
  setActiveSheet: (index: number) => void;

  updateSheet: (fileIndex: number, sheetIndex: number, newSheet: SheetData) => void;
  addSheetToFile: (fileIndex: number, newSheet: SheetData) => void;
  clearRecentHistory: () => void;
  setTheme: (theme: ThemeMode) => void;
  setTableZoom: (zoom: number) => void;
  showToast: (toast: {
    type?: 'success' | 'error' | 'info';
    title: string;
    message?: string;
    path?: string;
    duration?: number;
  }) => void;
  dismissToast: (id: string) => void;

  /** Computed-like helpers */
  getActiveFile: () => FileData | null;
  getActiveSheet: () => SheetData | null;
}

export const useDataStore = create<DataStoreState>((set, get) => ({
  files: [],
  activeFileIndex: 0,
  activeSheetIndex: 0,
  recentHistory: loadInitialHistory(),
  theme: loadInitialTheme(),
  tableZoom: loadInitialTableZoom(),
  toasts: [],
  isInitialized: false,

  initWorkspace: async () => {
    try {
      const saved = await loadWorkspace();
      if (saved && saved.files && saved.files.length > 0) {
        set({
          files: saved.files,
          activeFileIndex: Math.min(Math.max(0, saved.activeFileIndex), saved.files.length - 1),
          activeSheetIndex: Math.max(0, saved.activeSheetIndex),
          isInitialized: true,
        });
        return;
      }
    } catch (err) {
      console.warn('[useDataStore] Failed to restore workspace from IndexedDB:', err);
    }
    set({ isInitialized: true });
  },

  reopenFromHistory: async (fileName: string) => {
    const existingIdx = get().files.findIndex((f) => f.fileName === fileName);
    if (existingIdx !== -1) {
      get().setActiveFile(existingIdx);
      return true;
    }
    const cached = await loadCachedFile(fileName);
    if (cached) {
      get().addFile(cached);
      return true;
    }
    return false;
  },

  showToast: ({ type = 'success', title, message, path, duration = 3500 }) => {
    const id = Math.random().toString(36).substring(7);
    const newToast: ToastItem = { id, type, title, message, path, duration };
    set((state) => ({ toasts: [...state.toasts, newToast] }));
    if (duration > 0) {
      setTimeout(() => {
        get().dismissToast(id);
      }, duration);
    }
  },

  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  setTheme: (theme: ThemeMode) => {
    applyThemeClass(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
    set({ theme });
  },

  addFile: (file) =>
    set((state) => {
      const totalRows = file.sheets.reduce((sum, s) => sum + s.rows.length, 0);
      const totalCols = file.sheets[0]?.headers.length || 0;
      const now = new Date();
      const timeStr = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      const historyItem: RecentHistoryItem = {
        id: Math.random().toString(36).substring(7),
        fileName: file.fileName,
        fileType: file.fileType,
        rowCount: totalRows,
        colCount: totalCols,
        timestamp: timeStr,
      };

      const updatedHistory = [
        historyItem,
        ...state.recentHistory.filter((h) => h.fileName !== file.fileName),
      ].slice(0, 25);

      persistHistory(updatedHistory);

      const updatedFiles = [...state.files, file];
      const newActiveIdx = updatedFiles.length - 1;

      schedulePersistWorkspace(updatedFiles, newActiveIdx, 0);

      return {
        files: updatedFiles,
        activeFileIndex: newActiveIdx,
        activeSheetIndex: 0,
        recentHistory: updatedHistory,
      };
    }),

  removeFile: (index) =>
    set((state) => {
      const newFiles = state.files.filter((_, i) => i !== index);
      let newActive = state.activeFileIndex;
      if (newActive >= newFiles.length) {
        newActive = Math.max(0, newFiles.length - 1);
      }
      schedulePersistWorkspace(newFiles, newActive, 0);
      return { files: newFiles, activeFileIndex: newActive, activeSheetIndex: 0 };
    }),

  setActiveFile: (index) =>
    set((state) => {
      schedulePersistWorkspace(state.files, index, 0);
      return { activeFileIndex: index, activeSheetIndex: 0 };
    }),

  setActiveSheet: (index) =>
    set((state) => {
      schedulePersistWorkspace(state.files, state.activeFileIndex, index);
      return { activeSheetIndex: index };
    }),

  updateSheet: (fileIndex, sheetIndex, newSheet) =>
    set((state) => {
      const newFiles = [...state.files];
      const targetFile = newFiles[fileIndex];
      if (!targetFile) return state;

      const newSheets = [...targetFile.sheets];
      newSheets[sheetIndex] = newSheet;
      newFiles[fileIndex] = { ...targetFile, sheets: newSheets };

      schedulePersistWorkspace(newFiles, state.activeFileIndex, state.activeSheetIndex);
      return { files: newFiles };
    }),

  addSheetToFile: (fileIndex, newSheet) =>
    set((state) => {
      const newFiles = [...state.files];
      const targetFile = newFiles[fileIndex];
      if (!targetFile) return state;

      const newSheets = [...targetFile.sheets, newSheet];
      newFiles[fileIndex] = { ...targetFile, sheets: newSheets };
      const newSheetIdx = newSheets.length - 1;

      schedulePersistWorkspace(newFiles, fileIndex, newSheetIdx);
      return {
        files: newFiles,
        activeSheetIndex: newSheetIdx,
      };
    }),

  clearRecentHistory: () => {
    persistHistory([]);
    set({ recentHistory: [] });
  },

  setTableZoom: (zoom: number) => {
    const clamped = Math.min(Math.max(70, Math.round(zoom)), 160);
    set({ tableZoom: clamped });
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(TABLE_ZOOM_KEY, String(clamped));
      }
    } catch {
      // ignore
    }
  },

  getActiveFile: () => {
    const { files, activeFileIndex } = get();
    return files[activeFileIndex] ?? null;
  },

  getActiveSheet: () => {
    const file = get().getActiveFile();
    if (!file) return null;
    return file.sheets[get().activeSheetIndex] ?? null;
  },
}));
