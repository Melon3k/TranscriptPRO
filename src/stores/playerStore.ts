import { create } from "zustand";

interface PlayerState {
  filePath: string | null;
  currentTimeMs: number; // milliseconds
  duration: number;      // seconds (from video element)
  isPlaying: boolean;

  setFilePath: (path: string) => void;
  setCurrentTimeMs: (ms: number) => void;
  setDuration: (s: number) => void;
  setIsPlaying: (playing: boolean) => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  filePath: null,
  currentTimeMs: 0,
  duration: 0,
  isPlaying: false,

  setFilePath: (path) => set({ filePath: path, currentTimeMs: 0 }),
  setCurrentTimeMs: (ms) => set({ currentTimeMs: ms }),
  setDuration: (s) => set({ duration: s }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
}));
