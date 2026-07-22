export type CaptionAlign = "left" | "center" | "right";
/** Caption-box anchor on the video, ASS numpad convention:
 *  1|2|3 = bottom L/C/R, 4|5|6 = middle, 7|8|9 = top. Drives the box REGION
 *  (margins) + vertical band; `align` drives the horizontal justification
 *  column, and the two combine into the exported ASS `Alignment`
 *  (see effective_alignment in ass.rs). */
export type CaptionBoxPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface CaptionStyle {
  fontId: string; // resolved font FAMILY name, e.g. "Outfit" | "Arial"; default "Outfit"
  fontSize: number; // px at 1080p reference height; 48
  letterSpacing: number; // px at reference size; 0
  align: CaptionAlign; // "center" (text-align inside the box)
  bold: boolean; // true (renders weight 700; ASS Bold=-1)
  italic: boolean; // false
  uppercase: boolean; // false (CSS text-transform; F2 uppercases text)
  outline: boolean; // true
  outlineWidth: number; // px at reference; 2 (ASS Outline)
  shadow: boolean; // false (mock shows off)
  shadowAngle: number; // shadow direction deg; 135 (0°=right, clockwise; +y down matches \pos)
  shadowDistance: number; // shadow offset px at reference; 4 (ASS Shadow depth along the angle)
  shadowSize: number; // shadow spread px; 0 (best-effort in the CSS preview)
  shadowBlur: number; // shadow blur px at reference; 4
  glow: boolean; // false — preview-only field with no faithful ASS mapping; default must export honestly
  glowStrength: number; // blur px at reference; 12
  background: boolean; // false — text-hugging pill behind the caption
  backgroundColor: string; // "#000000A6" (#RRGGBBAA; alpha carries the box opacity)
  backgroundRadius: number; // corner radius px at reference; 8
  backgroundSpread: number; // padding px at reference around the text; 12
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
// (not per-segment). Every animation type now serializes to ASS override tags
// (fade → \fad, karaoke → \k, pop → \fscx/\fscy \t, blur → \blur \t, slide →
// \move, typewriter → per-char \alpha \t). (The preview-only easing +
// per-word-delay knobs were removed — the UI only exposes what exports.)
export type CaptionAnimationType =
  | "none"
  | "fade"
  | "slide"
  | "pop"
  | "typewriter"
  | "karaoke"
  | "blur";
export interface CaptionAnimation {
  type: CaptionAnimationType; // default "none"
  durationMs: number; // 400 — fade in+out length / entrance length
  highlightColor: string; // "#22D3EE" — karaoke sung-word colour → ASS PrimaryColour
}
// Same forward-compat contract as CaptionStyle above: the store merges persisted
// animation over DEFAULT_CAPTION_ANIMATION, so later-added fields rehydrate to
// their defaults. Never rename fields; only add.

// Every animation type except "none" serializes to ASS override tags; this set
// only gates UI badges and the Rail export warning (the Rust serializer keys off
// animation.anim_type strings directly).
export const EXPORTED_ANIMATIONS: ReadonlySet<CaptionAnimationType> = new Set([
  "fade",
  "karaoke",
  "slide",
  "pop",
  "typewriter",
  "blur",
]);

// Types whose entrance is exported but only approximately: they animate via ASS
// \t (linear only), so the exported motion differs slightly from the CSS
// preview. fade (\fad) and karaoke (\k timings) map faithfully and are
// excluded. Gates the Rail export notice.
export const APPROXIMATE_ANIMATIONS: ReadonlySet<CaptionAnimationType> = new Set([
  "slide",
  "pop",
  "typewriter",
  "blur",
]);
