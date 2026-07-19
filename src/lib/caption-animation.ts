import type {
  CaptionAnimation,
  CaptionAnimationType,
  CaptionEasing,
} from "../types/captionStyle";
import type { Subtitle } from "../types/subtitle";
import { normalizeHexColor } from "./caption-style";

export const DEFAULT_CAPTION_ANIMATION: CaptionAnimation = {
  type: "none",
  durationMs: 400,
  perWordDelayMs: 40,
  easing: "ease-out",
  highlightColor: "#22D3EE",
};

export type NumericAnimationField = "durationMs" | "perWordDelayMs";

// Slider ranges — single source of truth for the Animations tab UI.
export const ANIMATION_LIMITS: Record<
  NumericAnimationField,
  { min: number; max: number; step: number }
> = {
  durationMs: { min: 0, max: 2000, step: 50 },
  perWordDelayMs: { min: 0, max: 300, step: 10 },
};

export const EASINGS: readonly CaptionEasing[] = [
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
];

export const ANIMATION_TYPES: readonly CaptionAnimationType[] = [
  "none",
  "fade",
  "slide",
  "pop",
  "typewriter",
  "karaoke",
  "blur",
];

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

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

  if (!ANIMATION_TYPES.includes(anim.type)) {
    anim.type = DEFAULT_CAPTION_ANIMATION.type;
  }
  if (!EASINGS.includes(anim.easing)) {
    anim.easing = DEFAULT_CAPTION_ANIMATION.easing;
  }
  for (const field of Object.keys(ANIMATION_LIMITS) as NumericAnimationField[]) {
    const v: unknown = anim[field];
    const { min, max } = ANIMATION_LIMITS[field];
    anim[field] =
      typeof v === "number" && Number.isFinite(v)
        ? clamp(v, min, max)
        : DEFAULT_CAPTION_ANIMATION[field];
  }
  anim.highlightColor =
    typeof anim.highlightColor === "string" && /^#[0-9a-fA-F]{6}$/.test(anim.highlightColor)
      ? normalizeHexColor(anim.highlightColor)
      : DEFAULT_CAPTION_ANIMATION.highlightColor;

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
