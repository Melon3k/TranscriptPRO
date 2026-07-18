/**
 * Shared design-system style helpers for the redesigned UI.
 *
 * The imported prototype is built from inline styles over CSS variables
 * (see `src/styles/globals.css`). React style objects can't use the CSS `font`
 * shorthand, so `f()` expands it, and the colour/font constants keep the ported
 * components readable. Theme colours come through `var(--c-*)`; the accent
 * colours below are fixed across light/dark (straight from the brand palette).
 */
import type { CSSProperties } from "react";

// Fixed accent palette (brand) — theme-independent.
export const COLORS = {
  blue: "#2563FF",
  blueLight: "#5B8CFF",
  cyan: "#22D3EE",
  violet: "#7C3AED",
  violetLight: "#a78bfa",
  green: "#10B981",
  red: "#F0435B",
  amber: "#F5A524",
} as const;

export const FONTS = {
  display: '"Outfit", system-ui, sans-serif',
  body: '"Inter", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
} as const;

type FontFamilyKey = keyof typeof FONTS;

/** CSS `font` shorthand → style object. e.g. f(600, 12, "display"). */
export function f(
  weight: number,
  size: number,
  family: FontFamilyKey = "body",
  extra?: CSSProperties,
): CSSProperties {
  return {
    fontFamily: FONTS[family],
    fontWeight: weight,
    fontSize: size,
    ...extra,
  };
}

/** Left-rail nav icon button style. */
export function navStyle(active: boolean, disabled = false): CSSProperties {
  return {
    width: 42,
    height: 42,
    borderRadius: 11,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background .12s",
    background: active ? "rgba(37,99,255,.16)" : "transparent",
    color: active ? COLORS.blueLight : "var(--c-muted)",
    opacity: disabled ? 0.4 : 1,
  };
}

/** Right-panel tab style (Inspector / Animations / Effects). */
export function tabStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    textAlign: "center",
    padding: "10px 4px",
    cursor: "pointer",
    fontFamily: FONTS.body,
    fontWeight: 600,
    fontSize: 11,
    color: active ? "var(--c-text)" : "var(--c-muted)",
    borderBottom: active ? `2px solid ${COLORS.cyan}` : "2px solid transparent",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  };
}

/** Small uppercase section label ("MODEL WHISPER" etc.). */
export const sectionLabel: CSSProperties = {
  fontFamily: FONTS.body,
  fontWeight: 600,
  fontSize: 10,
  letterSpacing: ".1em",
  color: "var(--c-muted)",
  marginBottom: 6,
};

/** Primary action button (filled). Pass a background to override the blue. */
export function primaryBtn(
  bg: string = COLORS.blue,
  disabled = false,
): CSSProperties {
  return {
    height: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    background: disabled ? "var(--c-raised)" : bg,
    border: disabled ? "1px solid var(--c-border)" : "none",
    borderRadius: 9,
    fontFamily: FONTS.body,
    fontWeight: 600,
    fontSize: 13,
    color: disabled ? "var(--c-muted)" : "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    boxShadow: disabled ? "none" : `0 4px 16px ${bg}59`,
    width: "100%",
  };
}

/** Input-like field shell (selects, read-only value rows). */
export const fieldShell: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  height: 34,
  padding: "0 11px",
  background: "var(--c-input)",
  border: "1px solid var(--c-border)",
  borderRadius: 7,
};

/** A native <select> styled to sit inside the design's input shell. */
export const selectStyle: CSSProperties = {
  width: "100%",
  height: 34,
  padding: "0 10px",
  background: "var(--c-input)",
  border: "1px solid var(--c-border)",
  borderRadius: 7,
  color: "var(--c-text)",
  fontFamily: FONTS.body,
  fontWeight: 500,
  fontSize: 12,
  outline: "none",
  cursor: "pointer",
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
};

/** Modal scrim (covers the app frame). */
export const scrim: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(8,12,18,.72)",
  backdropFilter: "blur(2px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 60,
};

/** Card/panel surface used by modals. */
export function modalCard(width: number): CSSProperties {
  return {
    width,
    maxWidth: "94vw",
    background: "var(--c-panel)",
    border: "1px solid var(--c-border)",
    borderRadius: 14,
    boxShadow: "0 30px 70px rgba(0,0,0,.6)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };
}

/** Toggle switch (track + knob) style pair. */
export function toggle(on: boolean, accent: string = COLORS.blue): {
  track: CSSProperties;
  knob: CSSProperties;
} {
  return {
    track: {
      width: 34,
      height: 20,
      borderRadius: 11,
      position: "relative",
      cursor: "pointer",
      flex: "none",
      background: on ? accent : "var(--c-border)",
      transition: "background .15s",
    },
    knob: {
      position: "absolute",
      top: 2,
      left: on ? 16 : 2,
      width: 16,
      height: 16,
      borderRadius: "50%",
      background: "#fff",
      transition: "left .15s",
    },
  };
}

export function stop(e: { stopPropagation?: () => void }) {
  e.stopPropagation?.();
}
