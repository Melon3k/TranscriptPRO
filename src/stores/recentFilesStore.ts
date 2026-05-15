import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface RecentFile {
  path: string;
  kind: "media" | "srt";
  openedAt: number;
}

interface RecentFilesState {
  files: RecentFile[];
  record: (path: string, kind: "media" | "srt") => void;
  clear: () => void;
}

export const useRecentFilesStore = create<RecentFilesState>()(
  persist(
    (set) => ({
      files: [],
      record: (path, kind) =>
        set((s) => {
          const deduped = s.files.filter((f) => f.path !== path);
          return {
            files: [{ path, kind, openedAt: Date.now() }, ...deduped].slice(0, 10),
          };
        }),
      clear: () => set({ files: [] }),
    }),
    { name: "transcriptpro-recent-files" }
  )
);
