import { create } from "zustand";
import { Subtitle } from "../types/subtitle";
import { splitSegment, mergeSegments, reindex } from "../lib/subtitle-ops";

interface SubtitleState {
  subtitles: Subtitle[];
  // Undo/redo history (Phase 7)
  past: Subtitle[][];
  future: Subtitle[][];

  // Actions
  setSubtitles: (subtitles: Subtitle[]) => void;
  updateSubtitle: (id: string, changes: Partial<Subtitle>) => void;
  splitSegment: (id: string) => void;
  mergeUp: (id: string) => void;
  mergeDown: (id: string) => void;
  deleteSegment: (id: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

const HISTORY_LIMIT = 50;

function pushHistory(
  past: Subtitle[][],
  current: Subtitle[]
): Subtitle[][] {
  const updated = [...past, current];
  return updated.slice(-HISTORY_LIMIT);
}

export const useSubtitleStore = create<SubtitleState>((set, get) => ({
  subtitles: [],
  past: [],
  future: [],

  setSubtitles: (subtitles) => {
    set({
      subtitles: reindex(subtitles),
      past: pushHistory(get().past, get().subtitles),
      future: [],
    });
  },

  updateSubtitle: (id, changes) => {
    set((state) => ({
      past: pushHistory(state.past, state.subtitles),
      future: [],
      subtitles: state.subtitles.map((s) =>
        s.id === id ? { ...s, ...changes } : s
      ),
    }));
  },

  splitSegment: (id) => {
    set((state) => ({
      past: pushHistory(state.past, state.subtitles),
      future: [],
      subtitles: splitSegment(state.subtitles, id),
    }));
  },

  mergeUp: (id) => {
    set((state) => ({
      past: pushHistory(state.past, state.subtitles),
      future: [],
      subtitles: mergeSegments(state.subtitles, id, "up"),
    }));
  },

  mergeDown: (id) => {
    set((state) => ({
      past: pushHistory(state.past, state.subtitles),
      future: [],
      subtitles: mergeSegments(state.subtitles, id, "down"),
    }));
  },

  deleteSegment: (id) => {
    set((state) => ({
      past: pushHistory(state.past, state.subtitles),
      future: [],
      subtitles: reindex(state.subtitles.filter((s) => s.id !== id)),
    }));
  },

  undo: () => {
    const { past, subtitles } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    set({
      subtitles: previous,
      past: past.slice(0, -1),
      future: [subtitles, ...get().future].slice(0, HISTORY_LIMIT),
    });
  },

  redo: () => {
    const { future, subtitles } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      subtitles: next,
      past: pushHistory(get().past, subtitles),
      future: future.slice(1),
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));
