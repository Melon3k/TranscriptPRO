import { create } from "zustand";

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogEntry {
  level: LogLevel;
  source: string;
  message: string;
  timestamp: number;
}

interface LogState {
  entries: LogEntry[];
  open: boolean;
  append: (entry: LogEntry) => void;
  clear: () => void;
  togglePanel: () => void;
  setOpen: (open: boolean) => void;
}

const MAX_ENTRIES = 500;

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  open: false,
  append: (entry) =>
    set((s) => {
      const next = s.entries.length >= MAX_ENTRIES ? s.entries.slice(-MAX_ENTRIES + 1) : s.entries;
      return { entries: [...next, entry] };
    }),
  clear: () => set({ entries: [] }),
  togglePanel: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
}));
