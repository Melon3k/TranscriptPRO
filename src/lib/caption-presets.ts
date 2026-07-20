import type { CaptionStyle } from "../types/captionStyle";
import { DEFAULT_CAPTION_STYLE, sanitizeCaptionStyle } from "./caption-style";

/** A named full-style snapshot. User presets carry a uuid id and the literal
 *  user-typed name; built-ins are code constants (see BUILTIN_PRESETS) with a
 *  "builtin:<slug>" id and a name resolved via i18n at render time. */
export interface CaptionPreset {
  id: string;
  name: string;
  style: CaptionStyle;
}

/** Built-in preset: name is an i18n key resolved per locale, not a literal. */
export interface BuiltinPreset {
  id: string;
  nameKey: string;
  style: CaptionStyle;
}

// Full CaptionStyle snapshots (spread DEFAULT + overrides) so applying is a
// straight setStyle(preset.style). All values verified inside STYLE_LIMITS.
export const BUILTIN_PRESETS: readonly BuiltinPreset[] = [
  {
    id: "builtin:neon",
    nameKey: "style:presets.builtin.neon",
    style: {
      ...DEFAULT_CAPTION_STYLE,
      bold: true,
      outline: true,
      outlineWidth: 1,
      outlineColor: "#0B0F16FF",
      shadow: false,
      glow: true,
      glowStrength: 18,
      glowColor: "#22D3EEFF",
      textColor: "#FFFFFFFF",
    },
  },
  {
    id: "builtin:hardShadow",
    nameKey: "style:presets.builtin.hardShadow",
    style: {
      ...DEFAULT_CAPTION_STYLE,
      bold: true,
      outline: true,
      outlineWidth: 1,
      outlineColor: "#0B0F16FF",
      shadow: true,
      shadowDepth: 5,
      shadowColor: "#000000FF",
      glow: false,
    },
  },
  {
    id: "builtin:thickOutline",
    nameKey: "style:presets.builtin.thickOutline",
    style: {
      ...DEFAULT_CAPTION_STYLE,
      bold: true,
      outline: true,
      outlineWidth: 5,
      outlineColor: "#0B0F16FF",
      shadow: false,
      glow: false,
    },
  },
  {
    id: "builtin:soft",
    nameKey: "style:presets.builtin.soft",
    style: {
      ...DEFAULT_CAPTION_STYLE,
      bold: false,
      outline: false,
      shadow: true,
      shadowDepth: 3,
      shadowColor: "#000000FF",
      glow: false,
      textColor: "#FFFFFFFF",
    },
  },
];

/** Value-equality over every CaptionStyle field. All fields are primitives and
 *  slider values are fixed-step, so per-key === is exact (no float drift). */
export function stylesEqual(a: CaptionStyle, b: CaptionStyle): boolean {
  return (Object.keys(DEFAULT_CAPTION_STYLE) as (keyof CaptionStyle)[]).every(
    (k) => a[k] === b[k],
  );
}

/** Scrub a persisted/hand-edited preset: null unless it's an object with a
 *  non-empty string name. Style is rebuilt via sanitizeCaptionStyle; a missing
 *  id gets a fresh uuid. Used by the store merge. */
export function sanitizePreset(raw: unknown): CaptionPreset | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as { id?: unknown; name?: unknown; style?: unknown };
  if (typeof obj.name !== "string" || obj.name.trim() === "") return null;
  return {
    id: typeof obj.id === "string" && obj.id !== "" ? obj.id : newPresetId(),
    name: obj.name,
    style: sanitizeCaptionStyle(obj.style),
  };
}

/** Fresh preset id: crypto.randomUUID when available, else a WebView fallback. */
export function newPresetId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** base, else `${base} 2`, `${base} 3`… until unused (case-insensitive). */
export function uniquePresetName(base: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
