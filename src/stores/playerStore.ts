import { create } from "zustand";

interface PlayerState {
  filePath: string | null;
  // Display-only lightweight proxy for the Player. filePath STAYS the original —
  // transcription and burn-in read filePath and must use the full-res source.
  previewPath: string | null;
  previewLoading: boolean;
  previewPct: number; // 0..100 proxy transcode progress
  currentTimeMs: number; // milliseconds
  duration: number;      // seconds (from video element)
  isPlaying: boolean;

  setFilePath: (path: string) => void;
  setPreviewPath: (path: string | null) => void;
  setPreviewLoading: (loading: boolean) => void;
  setPreviewPct: (pct: number) => void;
  setCurrentTimeMs: (ms: number) => void;
  setDuration: (s: number) => void;
  setIsPlaying: (playing: boolean) => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  filePath: null,
  previewPath: null,
  previewLoading: false,
  previewPct: 0,
  currentTimeMs: 0,
  duration: 0,
  isPlaying: false,

  // A new file invalidates any previous proxy — reset so the Player re-prepares.
  setFilePath: (path) =>
    set({ filePath: path, currentTimeMs: 0, previewPath: null, previewLoading: false, previewPct: 0 }),
  setPreviewPath: (path) => set({ previewPath: path }),
  setPreviewLoading: (loading) => set({ previewLoading: loading }),
  setPreviewPct: (pct) => set({ previewPct: pct }),
  setCurrentTimeMs: (ms) => set({ currentTimeMs: ms }),
  setDuration: (s) => set({ duration: s }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
}));
