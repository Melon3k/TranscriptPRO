export type CaptionFontId = "outfit" | "inter" | "jetbrains-mono";
export type CaptionAlign = "left" | "center" | "right";
/** Caption-box anchor on the video, ASS numpad convention:
 *  1|2|3 = bottom L/C/R, 4|5|6 = middle, 7|8|9 = top. F2 writes this number
 *  straight into the ASS Style `Alignment` field. */
export type CaptionBoxPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface CaptionStyle {
  fontId: CaptionFontId; // "outfit"
  fontSize: number; // px at 1080p reference height; 48
  letterSpacing: number; // px at reference size; 0
  lineHeight: number; // unitless multiplier; 1.15
  align: CaptionAlign; // "center" (text-align inside the box)
  bold: boolean; // true (renders weight 700; ASS Bold=-1)
  italic: boolean; // false
  uppercase: boolean; // false (CSS text-transform; F2 uppercases text)
  outline: boolean; // true
  outlineWidth: number; // px at reference; 2 (ASS Outline)
  shadow: boolean; // false (mock shows off)
  shadowDepth: number; // px at reference; 2 (ASS Shadow)
  glow: boolean; // false — preview-only field with no faithful ASS mapping; default must export honestly
  glowStrength: number; // blur px at reference; 12
  textColor: string; // "#FFFFFF" (#RRGGBB; F2 converts to &HAABBGGRR)
  outlineColor: string; // "#0B0F16" (current overlay outline)
  shadowColor: string; // "#000000"
  glowColor: string; // "#22D3EE" (COLORS.cyan)
  boxPosition: CaptionBoxPosition; // 2 = bottom-center
  widthPct: number; // 62 (caption box max-width, % of video)
  marginVPct: number; // 8 (distance from anchored top/bottom edge, %)
}
// Forward-compat contract: adding fields later (e.g. free x/y for item B, or
// Subtitle.styleOverride?: Partial<CaptionStyle>) must not break persisted
// state — the store merges persisted state over DEFAULT_CAPTION_STYLE, so
// every missing field falls back to the default. Never rename fields; only add.

// Item C: ONE global animation, a sibling of the global style in styleStore
// (not per-segment). Two types export to ASS (fade → \fad, karaoke → \k +
// Primary/Secondary colour split); the rest are preview-only.
export type CaptionAnimationType =
  | "none"
  | "fade"
  | "slide"
  | "pop"
  | "typewriter"
  | "karaoke"
  | "blur";
export type CaptionEasing = "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";
export interface CaptionAnimation {
  type: CaptionAnimationType; // default "none"
  durationMs: number; // 400 — fade in+out length / entrance length
  perWordDelayMs: number; // 40 — stagger; PREVIEW-ONLY (slide/pop/typewriter/blur)
  easing: CaptionEasing; // "ease-out" — PREVIEW-ONLY (ASS \fad is linear)
  highlightColor: string; // "#22D3EE" — karaoke sung-word colour → ASS PrimaryColour
}
// Same forward-compat contract as CaptionStyle above: the store merges persisted
// animation over DEFAULT_CAPTION_ANIMATION, so later-added fields rehydrate to
// their defaults. Never rename fields; only add.

// Only these two serialize to ASS; the others animate in the Player overlay but
// are explicitly NOT exported (item C decision).
export const EXPORTED_ANIMATIONS: ReadonlySet<CaptionAnimationType> = new Set([
  "fade",
  "karaoke",
]);
