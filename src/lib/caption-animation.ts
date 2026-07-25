import type {
  AnimationDirection,
  AnimationGranularity,
  CaptionAnimation,
  CaptionAnimationType,
  KaraokeHighlight,
} from "../types/captionStyle";
import {
  ANIMATION_DIRECTION_OPTIONS,
  ANIMATION_GRANULARITY_OPTIONS,
  KARAOKE_HIGHLIGHT_OPTIONS,
} from "../types/captionStyle";
import type { Subtitle } from "../types/subtitle";
import { normalizeHexColor } from "./caption-style";

export const DEFAULT_CAPTION_ANIMATION: CaptionAnimation = {
  type: "none",
  durationMs: 400,
  highlightColor: "#22D3EEFF",
  granularity: "word",
  direction: "in",
  staggerMs: 40,
  karaokeHighlight: "text",
};

export type NumericAnimationField = "durationMs" | "staggerMs";

// Slider ranges — single source of truth for the Animations tab UI.
export const ANIMATION_LIMITS: Record<
  NumericAnimationField,
  { min: number; max: number; step: number }
> = {
  durationMs: { min: 0, max: 2000, step: 50 },
  staggerMs: { min: 0, max: 200, step: 5 },
};

export const ANIMATION_TYPES: readonly CaptionAnimationType[] = [
  "none",
  "fade",
  "scale",
  "typewriter",
  "decode",
  "slide",
  "blur",
  "colorShift",
  "blurDrop",
  "staircase",
  "karaoke",
];

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// Clamp a persisted enum value into the type's allowed menu. When the menu is
// empty the field is ignored downstream, so it is normalised to the default.
function clampChoice<T extends string>(
  raw: unknown,
  options: readonly T[],
  fallback: T,
): T {
  if (options.length === 0) return fallback;
  return typeof raw === "string" && (options as readonly string[]).includes(raw)
    ? (raw as T)
    : options[0];
}

/** Rebuild a full CaptionAnimation from untrusted persisted data, mirroring
 *  sanitizeCaptionStyle: missing fields fall back to defaults per the
 *  forward-compat contract; present fields are validated per type so a single
 *  bad value can't poison the preview or ASS export. */
export function sanitizeCaptionAnimation(persisted: unknown): CaptionAnimation {
  const raw =
    typeof persisted === "object" && persisted !== null
      ? (persisted as Partial<CaptionAnimation>)
      : {};
  const anim: CaptionAnimation = { ...DEFAULT_CAPTION_ANIMATION, ...raw };

  // Legacy "pop" (removed) is subsumed by "scale" — migrate rather than drop.
  if ((anim.type as string) === "pop") anim.type = "scale";
  if (!ANIMATION_TYPES.includes(anim.type)) {
    anim.type = DEFAULT_CAPTION_ANIMATION.type;
  }
  for (const field of Object.keys(ANIMATION_LIMITS) as NumericAnimationField[]) {
    const v: unknown = anim[field];
    const { min, max } = ANIMATION_LIMITS[field];
    anim[field] =
      typeof v === "number" && Number.isFinite(v)
        ? clamp(v, min, max)
        : DEFAULT_CAPTION_ANIMATION[field];
  }
  // Accept 6- or 8-digit hex; normalizeHexColor migrates 6-digit → +FF.
  anim.highlightColor =
    typeof anim.highlightColor === "string" &&
    /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(anim.highlightColor)
      ? normalizeHexColor(anim.highlightColor)
      : DEFAULT_CAPTION_ANIMATION.highlightColor;

  // Clamp sub-options into the menu their type exposes (empty menu → default).
  anim.granularity = clampChoice<AnimationGranularity>(
    anim.granularity,
    ANIMATION_GRANULARITY_OPTIONS[anim.type],
    DEFAULT_CAPTION_ANIMATION.granularity,
  );
  anim.direction = clampChoice<AnimationDirection>(
    anim.direction,
    ANIMATION_DIRECTION_OPTIONS[anim.type],
    DEFAULT_CAPTION_ANIMATION.direction,
  );
  anim.karaokeHighlight = clampChoice<KaraokeHighlight>(
    anim.karaokeHighlight,
    anim.type === "karaoke" ? KARAOKE_HIGHLIGHT_OPTIONS : [],
    DEFAULT_CAPTION_ANIMATION.karaokeHighlight,
  );

  return anim;
}

export interface KaraokeSegment {
  text: string; // token, with a trailing space kept between tokens for layout
  sung: boolean; // true once playback has reached this token's start
}

/** Split a cue into karaoke tokens with per-token "sung" state at nowMs.
 *  Uses real word timings when present; after translation `words` is empty, so
 *  it falls back to an even split across whitespace tokens (each token's start
 *  interpolated across the cue span) — matching the export-time fallback so the
 *  preview stays honest. */
export function karaokeSegments(sub: Subtitle, nowMs: number): KaraokeSegment[] {
  if (sub.words.length > 0) {
    return sub.words.map((w, i) => ({
      text: i < sub.words.length - 1 ? `${w.text} ` : w.text,
      sung: nowMs >= w.startTime,
    }));
  }
  const tokens = sub.text.split(/\s+/).filter((tk) => tk.length > 0);
  if (tokens.length === 0) return [];
  const span = Math.max(0, sub.endTime - sub.startTime);
  const per = span / tokens.length;
  return tokens.map((tk, i) => ({
    text: i < tokens.length - 1 ? `${tk} ` : tk,
    sung: nowMs >= sub.startTime + i * per,
  }));
}
