import type { CSSProperties } from "react";
import type {
  CaptionBoxPosition,
  CaptionFontId,
  CaptionStyle,
} from "../types/captionStyle";

// assName is consumed by F2 (ASS Fontname) and item A (picker labels).
export const CAPTION_FONTS: Record<
  CaptionFontId,
  { label: string; css: string; assName: string }
> = {
  outfit: {
    label: "Outfit",
    css: '"Outfit", system-ui, sans-serif',
    assName: "Outfit",
  },
  inter: {
    label: "Inter",
    css: '"Inter", system-ui, sans-serif',
    assName: "Inter",
  },
  "jetbrains-mono": {
    label: "JetBrains Mono",
    css: '"JetBrains Mono", ui-monospace, Menlo, monospace',
    assName: "JetBrains Mono",
  },
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontId: "outfit",
  fontSize: 48,
  letterSpacing: 0,
  lineHeight: 1.15,
  align: "center",
  bold: true,
  italic: false,
  uppercase: false,
  outline: true,
  outlineWidth: 2,
  shadow: false,
  shadowDepth: 2,
  glow: false,
  glowStrength: 12,
  textColor: "#FFFFFF",
  outlineColor: "#0B0F16",
  shadowColor: "#000000",
  glowColor: "#22D3EE",
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
  | "lineHeight"
  | "outlineWidth"
  | "shadowDepth"
  | "glowStrength"
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
  lineHeight: { min: 0.9, max: 2, step: 0.05 },
  outlineWidth: { min: 0, max: 10, step: 0.5 },
  shadowDepth: { min: 0, max: 10, step: 0.5 },
  glowStrength: { min: 0, max: 40, step: 1 },
  widthPct: { min: 20, max: 100, step: 1 },
  marginVPct: { min: 0, max: 30, step: 0.5 },
};

/** Uppercase a native color-input value so persisted values stay canonical
 *  ("#22d3ee" → "#22D3EE"); non-#RRGGBB inputs are returned unchanged. */
export function normalizeHexColor(v: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : v;
}

const BOOL_STYLE_FIELDS = [
  "bold",
  "italic",
  "uppercase",
  "outline",
  "shadow",
  "glow",
] as const;

const COLOR_STYLE_FIELDS = [
  "textColor",
  "outlineColor",
  "shadowColor",
  "glowColor",
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

  if (!(style.fontId in CAPTION_FONTS)) {
    style.fontId = DEFAULT_CAPTION_STYLE.fontId;
  }
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
    style[field] =
      typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)
        ? normalizeHexColor(v)
        : DEFAULT_CAPTION_STYLE[field];
  }

  return style;
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

/** Text styling for the caption. fontSize is NOT set here — the Player owns
 *  scaling; all derived lengths are in em so they follow it. */
export function captionTextCss(style: CaptionStyle): CSSProperties {
  const layers: string[] = [];

  if (style.outline) {
    // Clean outline via layered shadows — avoids the "chewed" look
    // that -webkit-text-stroke produces when the stroke overlaps the fill.
    const w = em(style.outlineWidth, style.fontSize);
    const c = style.outlineColor;
    layers.push(
      `-${w} -${w} 0 ${c}`,
      `${w} -${w} 0 ${c}`,
      `-${w} ${w} 0 ${c}`,
      `${w} ${w} 0 ${c}`,
    );
  }
  if (style.shadow) {
    layers.push(
      `0 ${em(style.shadowDepth, style.fontSize)} ${em(style.shadowDepth * 2, style.fontSize)} ${style.shadowColor}`,
    );
  }
  if (style.glow) {
    layers.push(`0 0 ${em(style.glowStrength, style.fontSize)} ${style.glowColor}`);
  }

  // Persisted state can carry a fontId this build doesn't know (newer build,
  // hand-edited localStorage) — fall back to the default instead of throwing.
  const font = CAPTION_FONTS[style.fontId] ?? CAPTION_FONTS[DEFAULT_CAPTION_STYLE.fontId];

  return {
    display: "block",
    fontFamily: font.css,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    textTransform: style.uppercase ? "uppercase" : "none",
    textAlign: style.align,
    // Preserve embedded \n from SRT cues so the preview line-breaks exactly
    // where the ASS export (\N) will — F2 honesty guarantee.
    whiteSpace: "pre-line",
    lineHeight: style.lineHeight,
    color: style.textColor,
    letterSpacing: em(style.letterSpacing, style.fontSize),
    textShadow: layers.length > 0 ? layers.join(", ") : undefined,
  };
}
