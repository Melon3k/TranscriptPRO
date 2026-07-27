import type { CSSProperties } from "react";
import type { CaptionAnimation, CaptionBoxPosition, CaptionStyle } from "../types/captionStyle";

// The three bundled quick-picks (guaranteed-faithful defaults + offline
// fallback); the picker lists these under a "Bundled" heading, the full
// installed-family list below. The stored fontId is now an arbitrary family
// name, so this is a LIST keyed by family, not an id→font map.
export const CAPTION_FONTS: { family: string; label: string; css: string }[] = [
  { family: "Outfit", label: "Outfit", css: '"Outfit", system-ui, sans-serif' },
  { family: "Inter", label: "Inter", css: '"Inter", system-ui, sans-serif' },
  {
    family: "JetBrains Mono",
    label: "JetBrains Mono",
    css: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  },
];

export const BUNDLED_FAMILIES: ReadonlySet<string> = new Set(
  CAPTION_FONTS.map((f) => f.family),
);

/** CSS font-family stack for a caption family: the bundled stack when it's one
 *  of the three, else the (installed) system family quoted with a generic
 *  fallback so an unknown/uninstalled name still degrades gracefully. */
export function fontFamilyCss(family: string): string {
  const bundled = CAPTION_FONTS.find((f) => f.family === family);
  return bundled ? bundled.css : `"${family}", system-ui, sans-serif`;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontId: "Outfit",
  fontSize: 48,
  letterSpacing: 0,
  align: "center",
  bold: true,
  italic: false,
  uppercase: false,
  outline: true,
  outlineWidth: 2,
  shadow: false,
  shadowAngle: 135,
  shadowDistance: 4,
  shadowSize: 0,
  shadowBlur: 4,
  glow: false,
  glowStrength: 12,
  background: false,
  backgroundColor: "#000000A6",
  backgroundRadius: 8,
  backgroundSpread: 12,
  textColor: "#FFFFFFFF",
  outlineColor: "#0B0F16FF",
  shadowColor: "#000000FF",
  glowColor: "#22D3EEFF",
  boxPosition: 2,
  widthPct: 62,
  marginVPct: 8,
};

// Visual 3x3 grid in row-major order (top row first) → ASS numpad values.
// The Inspector highlights the cell where BOX_GRID[i] === style.boxPosition.
export const BOX_GRID: readonly CaptionBoxPosition[] = [7, 8, 9, 4, 5, 6, 1, 2, 3];

export type NumericStyleField =
  | "fontSize"
  | "letterSpacing"
  | "outlineWidth"
  | "shadowAngle"
  | "shadowDistance"
  | "shadowSize"
  | "shadowBlur"
  | "glowStrength"
  | "backgroundRadius"
  | "backgroundSpread"
  | "widthPct"
  | "marginVPct";

// Slider ranges — single source of truth for the Inspector UI. Must stay
// inside the clamps ass.rs applies (widthPct 10–100, marginVPct 0–45).
export const STYLE_LIMITS: Record<
  NumericStyleField,
  { min: number; max: number; step: number }
> = {
  fontSize: { min: 16, max: 120, step: 1 },
  letterSpacing: { min: -2, max: 10, step: 0.5 },
  outlineWidth: { min: 0, max: 10, step: 0.5 },
  shadowAngle: { min: 0, max: 360, step: 1 },
  shadowDistance: { min: 0, max: 40, step: 0.5 },
  shadowSize: { min: 0, max: 20, step: 0.5 },
  shadowBlur: { min: 0, max: 40, step: 1 },
  glowStrength: { min: 0, max: 40, step: 1 },
  backgroundRadius: { min: 0, max: 60, step: 1 },
  backgroundSpread: { min: 0, max: 60, step: 1 },
  widthPct: { min: 20, max: 100, step: 1 },
  marginVPct: { min: 0, max: 30, step: 0.5 },
};

// Legacy fontId union values (pre-system-fonts) → their bundled family names.
const LEGACY_FONT_IDS: Record<string, string> = {
  outfit: "Outfit",
  inter: "Inter",
  "jetbrains-mono": "JetBrains Mono",
};

const COLOR_HEX_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/** Parse `#RRGGBB` (a=255) or `#RRGGBBAA` (case-insensitive) into 0–255 bytes.
 *  Returns null for anything else so callers never build NaN color strings. */
export function parseHexColor(
  v: string,
): { r: number; g: number; b: number; a: number } | null {
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(v);
  if (!m) return null;
  const hex = m[1];
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: m[2] ? parseInt(m[2], 16) : 255,
  };
}

/** Compose four channels into an uppercase, zero-padded `#RRGGBBAA`. Each is
 *  clamped to 0–255; non-finite inputs collapse to 0 (never emits NaN). */
export function rgbaToHex8(r: number, g: number, b: number, a: number): string {
  const byte = (n: number): string => {
    const c = Math.min(255, Math.max(0, n));
    const v = Number.isFinite(c) ? Math.round(c) : 0; // NaN → 0; ±Infinity saturates
    return v.toString(16).padStart(2, "0").toUpperCase();
  };
  return `#${byte(r)}${byte(g)}${byte(b)}${byte(a)}`;
}

/** Convert a hex color to an `rgba()` string for the live overlay so alpha
 *  renders even on older WebKit. Invalid input falls back to opaque black. */
export function hexToCssColor(v: string): string {
  const c = parseHexColor(v);
  if (!c) return "rgba(0,0,0,1)";
  const alpha = Math.round((c.a / 255) * 1000) / 1000;
  return `rgba(${c.r},${c.g},${c.b},${alpha})`;
}

/** Canonicalize a color value: `#RRGGBB` → uppercase + `FF` (opaque migration),
 *  `#RRGGBBAA` → uppercase, anything else returned unchanged (draft passthrough
 *  current callers rely on while a value is still being edited). */
export function normalizeHexColor(v: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return `${v.toUpperCase()}FF`;
  if (/^#[0-9a-fA-F]{8}$/.test(v)) return v.toUpperCase();
  return v;
}

const BOOL_STYLE_FIELDS = [
  "bold",
  "italic",
  "uppercase",
  "outline",
  "shadow",
  "glow",
  "background",
] as const;

const COLOR_STYLE_FIELDS = [
  "textColor",
  "outlineColor",
  "shadowColor",
  "glowColor",
  "backgroundColor",
] as const;

/** Rebuild a full CaptionStyle from untrusted persisted data (hand-edited or
 *  foreign localStorage, future builds persisting changed types). Missing
 *  fields fall back to defaults per the forward-compat contract; present
 *  fields are validated per type — a single bad value must not poison the
 *  live preview (e.g. fontSize:null → em() emits "NaNem"). */
export function sanitizeCaptionStyle(persisted: unknown): CaptionStyle {
  const raw =
    typeof persisted === "object" && persisted !== null
      ? (persisted as Partial<CaptionStyle>)
      : {};
  const style: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, ...raw };

  // MIGRATION: shadowDepth was replaced by shadowAngle/Distance/Size/Blur.
  // Carry a legacy configured depth into shadowDistance so upgrades don't lose a
  // set shadow. Reads the legacy value off persisted like the color-alpha
  // migration; the numeric loop below clamps it to shadowDistance's range.
  const legacyDepth: unknown = (raw as { shadowDepth?: unknown }).shadowDepth;
  const hasNewDistance =
    typeof (raw as { shadowDistance?: unknown }).shadowDistance === "number";
  if (typeof legacyDepth === "number" && Number.isFinite(legacyDepth) && !hasNewDistance) {
    style.shadowDistance = legacyDepth;
  }

  // fontId is now an arbitrary family name. Migrate legacy bundled ids to
  // family names, accept any non-empty family verbatim, else default. No
  // persist-version bump — rides the merge→sanitize path (cf. color-alpha).
  const fid: unknown = style.fontId;
  const legacy =
    typeof fid === "string" &&
    Object.prototype.hasOwnProperty.call(LEGACY_FONT_IDS, fid)
      ? LEGACY_FONT_IDS[fid]
      : undefined;
  if (legacy !== undefined) style.fontId = legacy;
  else if (typeof fid === "string" && fid.trim() !== "") style.fontId = fid.trim();
  else style.fontId = DEFAULT_CAPTION_STYLE.fontId;
  if (!["left", "center", "right"].includes(style.align)) {
    style.align = DEFAULT_CAPTION_STYLE.align;
  }
  if (!Number.isInteger(style.boxPosition) || style.boxPosition < 1 || style.boxPosition > 9) {
    style.boxPosition = DEFAULT_CAPTION_STYLE.boxPosition;
  }
  // Out-of-range numbers clamp to the slider bounds (already inside the
  // export-time clamps ass.rs applies); non-numbers reset to defaults.
  for (const field of Object.keys(STYLE_LIMITS) as NumericStyleField[]) {
    const v: unknown = style[field];
    const { min, max } = STYLE_LIMITS[field];
    style[field] =
      typeof v === "number" && Number.isFinite(v)
        ? Math.min(max, Math.max(min, v))
        : DEFAULT_CAPTION_STYLE[field];
  }
  for (const field of BOOL_STYLE_FIELDS) {
    if (typeof style[field] !== "boolean") {
      style[field] = DEFAULT_CAPTION_STYLE[field];
    }
  }
  for (const field of COLOR_STYLE_FIELDS) {
    const v: unknown = style[field];
    // Accept 6- or 8-digit hex; normalizeHexColor migrates 6-digit → +FF.
    style[field] =
      typeof v === "string" && COLOR_HEX_RE.test(v)
        ? normalizeHexColor(v)
        : DEFAULT_CAPTION_STYLE[field];
  }

  return style;
}

/** CSS custom properties the `captionColorShift` keyframe reads: the accent it
 *  sweeps toward (--kf-accent) and the base colour it settles back to
 *  (--kf-base). --kf-base MUST carry textColor explicitly — the keyframe can't
 *  use `inherit`, which resolves to the UI theme colour with fill:both. Returns
 *  {} for other animations so callers can spread unconditionally. */
export function colorShiftVars(
  style: CaptionStyle,
  animation: CaptionAnimation,
): CSSProperties {
  if (animation.type !== "colorShift") return {};
  return {
    "--kf-accent": hexToCssColor(animation.highlightColor),
    "--kf-base": hexToCssColor(style.textColor),
  } as CSSProperties;
}

/** Round to 4 decimals so derived style strings stay stable across renders. */
function em(px: number, fontSize: number): string {
  return `${Math.round((px / fontSize) * 10000) / 10000}em`;
}

/** Absolute placement of the caption box inside the player stage. */
export function captionBoxCss(style: CaptionStyle): CSSProperties {
  const col = (style.boxPosition - 1) % 3; // 0=left 1=center 2=right
  const css: CSSProperties = {
    position: "absolute",
    maxWidth: `${style.widthPct}%`,
    userSelect: "none",
    pointerEvents: "none",
  };

  if (col === 0) css.left = "2%";
  else if (col === 2) css.right = "2%";
  else {
    css.left = "50%";
    css.transform = "translateX(-50%)";
  }

  if (style.boxPosition <= 3) {
    css.bottom = `${style.marginVPct}%`;
  } else if (style.boxPosition <= 6) {
    css.top = "50%";
    css.transform = col === 1 ? "translate(-50%,-50%)" : "translateY(-50%)";
  } else {
    css.top = `${style.marginVPct}%`;
  }

  return css;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

/** Convert a pointer position (ratios 0..1 inside the video frame) into the
 *  existing exportable placement fields. No free X: horizontal snaps to the
 *  ASS numpad columns and vertical to the rows, so preview == export. */
export function pointerToBoxPlacement(
  rx: number,
  ry: number,
  current: CaptionStyle,
): Pick<CaptionStyle, "boxPosition" | "marginVPct"> {
  const cx = clamp01(rx);
  const cy = clamp01(ry);
  const col = cx < 1 / 3 ? 0 : cx < 2 / 3 ? 1 : 2; // 0=left 1=center 2=right
  const band = cy < 1 / 3 ? "top" : cy < 2 / 3 ? "middle" : "bottom";
  const lim = STYLE_LIMITS.marginVPct;

  let boxPosition: CaptionBoxPosition;
  let marginVPct: number;
  if (band === "top") {
    boxPosition = (7 + col) as CaptionBoxPosition; // css.top = marginVPct%
    marginVPct = clamp(cy * 100, lim.min, lim.max);
  } else if (band === "bottom") {
    boxPosition = (1 + col) as CaptionBoxPosition; // css.bottom = marginVPct%
    marginVPct = clamp((1 - cy) * 100, lim.min, lim.max);
  } else {
    // captionBoxCss centers rows 4–6 and ignores marginVPct — keep current so
    // it survives dragging back out of the middle band.
    boxPosition = (4 + col) as CaptionBoxPosition;
    marginVPct = current.marginVPct;
  }
  marginVPct = Math.round(marginVPct / lim.step) * lim.step;
  return { boxPosition, marginVPct };
}

/** Convert a horizontal edge-drag ratio into widthPct, honoring where
 *  captionBoxCss anchors the box for the current column. */
export function pointerToWidthPct(rx: number, current: CaptionStyle): number {
  const cx = clamp01(rx);
  const col = (current.boxPosition - 1) % 3;
  let w: number;
  if (col === 1) w = Math.abs(cx - 0.5) * 2 * 100; // symmetric about center
  else if (col === 0) w = (cx - 0.02) * 100; // box left edge at 2%
  else w = (0.98 - cx) * 100; // box right edge at 2%
  const lim = STYLE_LIMITS.widthPct;
  return clamp(Math.round(w / lim.step) * lim.step, lim.min, lim.max);
}

/** Text styling for the caption. fontSize is NOT set here — the Player owns
 *  scaling; all derived lengths are in em so they follow it. */
export function captionTextCss(style: CaptionStyle): CSSProperties {
  const layers: string[] = [];

  if (style.outline) {
    // Clean CONTINUOUS outline via a ring of shadow copies on a circle of
    // radius = outlineWidth (avoids the "chewed" look -webkit-text-stroke gives
    // when the stroke overlaps the fill). Four corners alone sit at (±w,±w) —
    // i.e. w·√2 out — leaving the top/bottom/left/right edges bare, which reads
    // as broken diagonal blobs. Eight evenly-spaced directions (cardinals at w,
    // corners at 0.707·w) close the ring so the outline looks solid.
    const w = style.outlineWidth;
    const c = hexToCssColor(style.outlineColor);
    const k = 0.7071; // cos/sin 45°
    const dirs: [number, number][] = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [k, k], [-k, k], [k, -k], [-k, -k],
    ];
    for (const [dx, dy] of dirs) {
      layers.push(`${em(w * dx, style.fontSize)} ${em(w * dy, style.fontSize)} 0 ${c}`);
    }
  }
  if (style.shadow) {
    // 0°=right, growing clockwise; +y is down to match ASS \pos screen coords.
    const rad = (style.shadowAngle * Math.PI) / 180;
    const ox = em(style.shadowDistance * Math.cos(rad), style.fontSize);
    const oy = em(style.shadowDistance * Math.sin(rad), style.fontSize);
    const c = hexToCssColor(style.shadowColor);
    layers.push(`${ox} ${oy} ${em(style.shadowBlur, style.fontSize)} ${c}`);
    // shadowSize has no CSS text-shadow spread equivalent — best-effort: stack a
    // second, blurrier layer at the same offset so a larger size reads as a
    // thicker shadow (libass applies true spread on export).
    if (style.shadowSize > 0) {
      layers.push(`${ox} ${oy} ${em(style.shadowBlur + style.shadowSize, style.fontSize)} ${c}`);
    }
  }
  if (style.glow) {
    layers.push(
      `0 0 ${em(style.glowStrength, style.fontSize)} ${hexToCssColor(style.glowColor)}`,
    );
  }

  // Text-hugging pill: the caption box is shrink-to-fit (abspos, auto width), so
  // background + padding on the text element wraps the text tightly. px fields
  // are em-scaled like the rest so they follow the Player's fontSize scaling.
  const bg: CSSProperties = style.background
    ? {
        backgroundColor: hexToCssColor(style.backgroundColor),
        borderRadius: em(style.backgroundRadius, style.fontSize),
        padding: em(style.backgroundSpread, style.fontSize),
      }
    : {};

  return {
    ...bg,
    display: "block",
    fontFamily: fontFamilyCss(style.fontId),
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    textTransform: style.uppercase ? "uppercase" : "none",
    textAlign: style.align,
    // Preserve embedded \n from SRT cues so the preview line-breaks exactly
    // where the ASS export (\N) will — F2 honesty guarantee. Line spacing is
    // left at the CSS default: ASS/libass has no per-style line-height the
    // ffmpeg burn can carry, so the preview must not promise custom spacing.
    whiteSpace: "pre-line",
    color: hexToCssColor(style.textColor),
    letterSpacing: em(style.letterSpacing, style.fontSize),
    textShadow: layers.length > 0 ? layers.join(", ") : undefined,
  };
}
