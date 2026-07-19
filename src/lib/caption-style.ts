import type { CSSProperties } from "react";
import type { CaptionFontId, CaptionStyle } from "../types/captionStyle";

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
