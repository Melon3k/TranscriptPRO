import { create } from "zustand";
import { Subtitle } from "../types/subtitle";
import {
  splitSegment,
  mergeSegments,
  reindex,
  wordsToText,
  generateId,
  resegmentByLength,
  SegmentLimit,
} from "../lib/subtitle-ops";

interface SubtitleState {
  subtitles: Subtitle[];
  // Undo/redo history (Phase 7)
  past: Subtitle[][];
  future: Subtitle[][];

  // True when there are edits not yet written to a file (guards against data loss
  // on window close / app relaunch). Set by granular edits, cleared on load/export.
  dirty: boolean;

  // Comparison mode (original vs translated)
  originalSubtitles: Subtitle[] | null;
  comparisonMode: boolean;

  // Actions
  setSubtitles: (subtitles: Subtitle[], options?: { dirty?: boolean }) => void;
  updateSubtitle: (id: string, changes: Partial<Subtitle>) => void;
  splitSegment: (id: string) => void;
  mergeUp: (id: string) => void;
  mergeDown: (id: string) => void;
  deleteSegment: (id: string) => void;
  /** Split all segments longer than the limit at word boundaries (no-op if none exceed it). */
  resegment: (limit: SegmentLimit) => void;
  moveWords: (sourceSubId: string, wordIndices: number[], targetSubId: string, insertAt?: number) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Mark the current subtitles as persisted (called after a successful export). */
  markSaved: () => void;

  // Comparison actions
  setOriginalSubtitles: (subs: Subtitle[]) => void;
  clearOriginalSubtitles: () => void;
  setComparisonMode: (on: boolean) => void;
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
  dirty: false,
  originalSubtitles: null,
  comparisonMode: false,

  setSubtitles: (subtitles, options) => {
    // A bulk replace establishes a fresh baseline. Loads from a file or version history
    // are clean; generated content (transcription/translation) that wasn't auto-saved to
    // history is "dirty" — it lives only in memory and would be lost on close.
    set({
      subtitles: reindex(subtitles),
      past: pushHistory(get().past, get().subtitles),
      future: [],
      dirty: options?.dirty ?? false,
    });
  },

  updateSubtitle: (id, changes) => {
    set((state) => ({
      past: pushHistory(state.past, state.subtitles),
      future: [],
      dirty: true,
      subtitles: state.subtitles.map((s) =>
        s.id === id ? { ...s, ...changes } : s
      ),
    }));
  },

  splitSegment: (id) => {
    set((state) => ({
      past: pushHistory(state.past, state.subtitles),
      future: [],
      dirty: true,
      subtitles: splitSegment(state.subtitles, id),
    }));
  },

  mergeUp: (id) => {
    set((state) => ({
      past: pushHistory(state.past, state.subtitles),
      future: [],
      dirty: true,
      subtitles: mergeSegments(state.subtitles, id, "up"),
    }));
  },

  mergeDown: (id) => {
    set((state) => ({
      past: pushHistory(state.past, state.subtitles),
      future: [],
      dirty: true,
      subtitles: mergeSegments(state.subtitles, id, "down"),
    }));
  },

  deleteSegment: (id) => {
    set((state) => ({
      past: pushHistory(state.past, state.subtitles),
      future: [],
      dirty: true,
      subtitles: reindex(state.subtitles.filter((s) => s.id !== id)),
    }));
  },

  resegment: (limit) => {
    set((state) => {
      const next = resegmentByLength(state.subtitles, limit);
      if (next === state.subtitles) return state; // no-op — keep history clean
      return {
        past: pushHistory(state.past, state.subtitles),
        future: [],
        dirty: true,
        subtitles: next,
      };
    });
  },

  moveWords: (sourceSubId, wordIndices, targetSubId, insertAt) => {
    if (sourceSubId === targetSubId) return;
    set((state) => {
      const source = state.subtitles.find((s) => s.id === sourceSubId);
      const target = state.subtitles.find((s) => s.id === targetSubId);
      if (!source || !target) return state;

      const idxSet = new Set(wordIndices);
      const wordsToMove = source.words.filter((_, i) => idxSet.has(i));
      const remaining = source.words.filter((_, i) => !idxSet.has(i));
      if (wordsToMove.length === 0) return state;

      let newTargetWords;
      if (insertAt !== undefined) {
        const before = target.words.slice(0, insertAt);
        const after = target.words.slice(insertAt);
        newTargetWords = [...before, ...wordsToMove, ...after];
      } else {
        newTargetWords = [...target.words, ...wordsToMove].sort(
          (a, b) => a.startTime - b.startTime
        );
      }

      const newTarget: Subtitle = {
        ...target,
        words: newTargetWords,
        text: wordsToText(newTargetWords),
        startTime: Math.min(target.startTime, wordsToMove[0].startTime),
        endTime: Math.max(target.endTime, wordsToMove[wordsToMove.length - 1].endTime),
      };

      let newSubs: Subtitle[];
      if (remaining.length === 0) {
        newSubs = state.subtitles
          .filter((s) => s.id !== sourceSubId)
          .map((s) => (s.id === targetSubId ? newTarget : s));
      } else {
        const newSource: Subtitle = {
          ...source,
          id: generateId(),
          words: remaining,
          text: wordsToText(remaining),
          startTime: remaining[0].startTime,
          endTime: remaining[remaining.length - 1].endTime,
        };
        newSubs = state.subtitles.map((s) => {
          if (s.id === sourceSubId) return newSource;
          if (s.id === targetSubId) return newTarget;
          return s;
        });
      }

      return {
        past: pushHistory(state.past, state.subtitles),
        future: [],
        dirty: true,
        subtitles: reindex(newSubs),
      };
    });
  },

  undo: () => {
    const { past, subtitles } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    set({
      subtitles: previous,
      past: past.slice(0, -1),
      future: [subtitles, ...get().future].slice(0, HISTORY_LIMIT),
      dirty: true,
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
      dirty: true,
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
  markSaved: () => set({ dirty: false }),

  // Comparison
  setOriginalSubtitles: (subs) => set({ originalSubtitles: subs }),
  clearOriginalSubtitles: () =>
    set({ originalSubtitles: null, comparisonMode: false }),
  setComparisonMode: (on) => set({ comparisonMode: on }),
}));
