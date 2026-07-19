import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CaptionStyle } from "../types/captionStyle";
import { CAPTION_FONTS, DEFAULT_CAPTION_STYLE } from "../lib/caption-style";

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
  setStyle: (patch: Partial<CaptionStyle>) => void;
  resetStyle: () => void;
}

export const useStyleStore = create<StyleState>()(
  persist(
    (set) => ({
      style: DEFAULT_CAPTION_STYLE,
      setStyle: (patch) => set((s) => ({ style: { ...s.style, ...patch } })),
      resetStyle: () => set({ style: DEFAULT_CAPTION_STYLE }),
    }),
    {
      // Own localStorage key — caption style is document styling, not app
      // settings, and item D's presets will extend this store.
      name: "transcriptpro-caption-style",
      version: 1,
      partialize: ({ style }) => ({ style }),
      merge: (persisted, current) => {
        const style: CaptionStyle = {
          ...DEFAULT_CAPTION_STYLE,
          ...((persisted as Partial<StyleState> | undefined)?.style ?? {}),
        };
        // Enum VALUES aren't covered by the additive-fields contract: a newer
        // build (or hand-edited localStorage) may persist ones this build
        // doesn't know. Clamp them to defaults instead of throwing at render.
        if (!(style.fontId in CAPTION_FONTS)) {
          style.fontId = DEFAULT_CAPTION_STYLE.fontId;
        }
        if (!["left", "center", "right"].includes(style.align)) {
          style.align = DEFAULT_CAPTION_STYLE.align;
        }
        if (!Number.isInteger(style.boxPosition) || style.boxPosition < 1 || style.boxPosition > 9) {
          style.boxPosition = DEFAULT_CAPTION_STYLE.boxPosition;
        }
        return { ...current, style };
      },
    }
  )
);
