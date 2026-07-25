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
// (not per-segment). The set + granularity/direction knobs mirror the
// "100 Text Animations" gallery the product is standardising on. Every type
// except "none" serializes to ASS override tags (see ass.rs dialogue_text):
// fade → \fad, scale → \fscx/\fscy \t, slide → \move, blur → \blur \t,
// blurDrop → \move + \blur \t, colorShift → \t \1c, typewriter/decode →
// per-char \alpha \t, staircase → per-unit positioned \move, karaoke → \k.
// The animation renders on the MP4 ONLY through these tags (MP4 = libass
// burn-in of the exported ASS), so the CSS preview mirrors the ASS, never the
// other way round.
export type CaptionAnimationType =
  | "none"
  | "fade"
  | "scale" // gallery "Scale In"
  | "typewriter"
  | "decode" // gallery "Shuffle" made burn-in-safe: random-order per-char reveal
  | "slide" // gallery "Slide Up"
  | "blur" // gallery "Blur In" (+ left/right)
  | "colorShift" // gallery "Color Shift"
  | "blurDrop" // gallery "Blur Drop"
  | "staircase" // gallery "Staircase"
  | "karaoke";

// The unit that animates as one step. Empty granularity options (below) means
// the type animates as a whole line (this field is ignored for it).
export type AnimationGranularity = "char" | "word" | "line" | "sentence";
// Entrance origin edge. "in" = animate in place (no translation).
export type AnimationDirection = "in" | "up" | "down" | "left" | "right";
// Karaoke highlight target: recolour the word ("text"), draw a moving box behind
// it ("background"), or both.
export type KaraokeHighlight = "text" | "background" | "both";

export interface CaptionAnimation {
  type: CaptionAnimationType; // default "none"
  durationMs: number; // 400 — fade in+out length / per-unit entrance length
  highlightColor: string; // karaoke sung-word colour / colorShift accent → ASS colours
  granularity: AnimationGranularity; // default "word" (only read where options non-empty)
  direction: AnimationDirection; // default "in" (only read where options non-empty)
  staggerMs: number; // 40 — delay step between units (gallery delayStep)
  karaokeHighlight: KaraokeHighlight; // default "text" (only read for karaoke)
}
// Same forward-compat contract as CaptionStyle above: the store merges persisted
// animation over DEFAULT_CAPTION_ANIMATION, so later-added fields rehydrate to
// their defaults. Never rename fields; only add.

// Per-type sub-option menus — the SINGLE source of truth shared by the sanitizer
// (which clamps persisted values into the allowed set) and the Style panel UI
// (which only renders a control when its option list is non-empty). The FIRST
// entry is the default picked when switching into that type.
export const ANIMATION_GRANULARITY_OPTIONS: Record<
  CaptionAnimationType,
  readonly AnimationGranularity[]
> = {
  none: [],
  fade: [],
  scale: ["word", "line"],
  typewriter: [], // fixed per-char cadence
  decode: [], // fixed per-char
  slide: ["word", "line"],
  blur: [],
  colorShift: [],
  blurDrop: [],
  staircase: ["word", "sentence"],
  karaoke: [], // per-word, driven by word timings
};

export const ANIMATION_DIRECTION_OPTIONS: Record<
  CaptionAnimationType,
  readonly AnimationDirection[]
> = {
  none: [],
  fade: [],
  scale: [],
  typewriter: [],
  decode: [],
  slide: [], // always rises up
  blur: ["in", "left", "right"],
  colorShift: [],
  blurDrop: ["up", "down"], // from top / from bottom
  staircase: ["up", "down"],
  karaoke: [],
};

export const KARAOKE_HIGHLIGHT_OPTIONS: readonly KaraokeHighlight[] = [
  "text",
  "background",
  "both",
];

// Types whose per-unit stagger (staggerMs) knob is meaningful in the UI.
export const STAGGERED_ANIMATIONS: ReadonlySet<CaptionAnimationType> = new Set([
  "scale",
  "decode",
  "slide",
  "staircase",
]);

// Every animation type except "none" serializes to ASS override tags; this set
// only gates UI badges and the Rail export warning (the Rust serializer keys off
// animation.anim_type strings directly).
export const EXPORTED_ANIMATIONS: ReadonlySet<CaptionAnimationType> = new Set([
  "fade",
  "karaoke",
  "scale",
  "typewriter",
  "decode",
  "slide",
  "blur",
  "colorShift",
  "blurDrop",
  "staircase",
]);

// Types whose entrance is exported but only approximately: they animate via ASS
// \t (linear only), so the exported motion differs slightly from the CSS
// preview. fade (\fad) and karaoke (\k timings) map faithfully and are
// excluded. Gates the Rail export notice.
export const APPROXIMATE_ANIMATIONS: ReadonlySet<CaptionAnimationType> = new Set([
  "scale",
  "typewriter",
  "decode",
  "slide",
  "blur",
  "colorShift",
  "blurDrop",
  "staircase",
]);
