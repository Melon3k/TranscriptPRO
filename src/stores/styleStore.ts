import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CaptionStyle } from "../types/captionStyle";
import { DEFAULT_CAPTION_STYLE, sanitizeCaptionStyle } from "../lib/caption-style";
import type { CaptionPreset } from "../lib/caption-presets";
import { sanitizePreset, newPresetId } from "../lib/caption-presets";

// Accepted decisions (item F1): v1 holds ONE global style applied to all cues.
// Per-segment overrides arrive later as an additive
// `Subtitle.styleOverride?: Partial<CaptionStyle>` and must not require a
// persisted-shape change here. Forward compat is handled by `merge` below:
// persisted style is spread OVER DEFAULT_CAPTION_STYLE, so fields added in
// later items (item B free position, item D presets, overrides) rehydrate to
// their defaults instead of undefined — no migrate() needed yet. Fields are
// never renamed, only added.
interface StyleState {
  style: CaptionStyle;
  // Id of the preset last applied verbatim (built-in "builtin:<slug>" or a user
  // uuid), or null once the live style is edited. Identity, not value-equality,
  // decides which single card is "active" — two byte-identical presets must not
  // both light up.
  activePresetId: string | null;
  setStyle: (patch: Partial<CaptionStyle>) => void;
  applyPreset: (id: string, style: CaptionStyle) => void;
  resetStyle: () => void;
  // USER presets only; built-ins are code constants (BUILTIN_PRESETS) and are
  // never persisted here.
  presets: CaptionPreset[];
  addPreset: (name: string, style: CaptionStyle) => string;
  updatePreset: (id: string, patch: { name?: string; style?: CaptionStyle }) => void;
  deletePreset: (id: string) => void;
}

export const useStyleStore = create<StyleState>()(
  persist(
    (set) => ({
      style: DEFAULT_CAPTION_STYLE,
      activePresetId: null,
      // Any manual edit deselects the active preset: the live style no longer
      // matches a saved snapshot.
      setStyle: (patch) => set((s) => ({ style: { ...s.style, ...patch }, activePresetId: null })),
      applyPreset: (id, style) => set({ style, activePresetId: id }),
      resetStyle: () => set({ style: DEFAULT_CAPTION_STYLE, activePresetId: null }),
      presets: [],
      addPreset: (name, style) => {
        const id = newPresetId();
        set((s) => ({ presets: [...s.presets, { id, name, style }] }));
        return id;
      },
      updatePreset: (id, patch) =>
        set((s) => ({
          presets: s.presets.map((p) =>
            p.id === id
              ? {
                  ...p,
                  ...(patch.name !== undefined ? { name: patch.name } : {}),
                  ...(patch.style !== undefined ? { style: patch.style } : {}),
                }
              : p,
          ),
        })),
      deletePreset: (id) =>
        set((s) => ({
          presets: s.presets.filter((p) => p.id !== id),
          activePresetId: s.activePresetId === id ? null : s.activePresetId,
        })),
    }),
    {
      // Own localStorage key — caption style is document styling, not app
      // settings, and item D's presets will extend this store.
      name: "transcriptpro-caption-style",
      // KEEP version 1 (do NOT bump): merge below fully rebuilds state and
      // defaults presets to [] when absent, which is safe for the existing
      // F1-persisted shape (no presets key). A version bump would trigger a
      // migrate path that risks discarding that already-persisted state.
      version: 1,
      partialize: ({ style, presets, activePresetId }) => ({ style, presets, activePresetId }),
      // Persisted VALUES aren't covered by the additive-fields contract: a
      // newer build (or hand-edited localStorage) may persist enums this build
      // doesn't know, or numbers/booleans/colors of the wrong type or range.
      // sanitizeCaptionStyle clamps/defaults every field instead of letting a
      // bad value break the live preview. Presets are scrubbed the same way
      // (sanitizePreset), dropping any that fail validation.
      merge: (persisted, current) => {
        const p = persisted as Partial<StyleState> | undefined;
        return {
          ...current,
          style: sanitizeCaptionStyle(p?.style),
          activePresetId: typeof p?.activePresetId === "string" ? p.activePresetId : null,
          presets: Array.isArray(p?.presets)
            ? p.presets
                .map(sanitizePreset)
                .filter((x): x is CaptionPreset => x !== null)
            : [],
        };
      },
    }
  )
);
