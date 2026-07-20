import { describe, it, expect } from "vitest";
import { EXPORTED_ANIMATIONS } from "../types/captionStyle";
import {
  ANIMATION_LIMITS,
  ANIMATION_TYPES,
  DEFAULT_CAPTION_ANIMATION,
  EASINGS,
  sanitizeCaptionAnimation,
} from "./caption-animation";

// ── animation constants ──────────────────────────────────────────────────────

describe("animation constants", () => {
  it("ANIMATION_LIMITS ranges are sane and contain the defaults", () => {
    for (const [field, { min, max, step }] of Object.entries(ANIMATION_LIMITS)) {
      expect(min, field).toBeLessThan(max);
      expect(step, field).toBeGreaterThan(0);
      const value = DEFAULT_CAPTION_ANIMATION[field as keyof typeof ANIMATION_LIMITS];
      expect(value, field).toBeGreaterThanOrEqual(min);
      expect(value, field).toBeLessThanOrEqual(max);
    }
  });

  it("default enums are members of their unions", () => {
    expect(ANIMATION_TYPES).toContain(DEFAULT_CAPTION_ANIMATION.type);
    expect(EASINGS).toContain(DEFAULT_CAPTION_ANIMATION.easing);
  });

  it("only fade and karaoke export to ASS", () => {
    expect([...EXPORTED_ANIMATIONS].sort()).toEqual(["fade", "karaoke"]);
  });
});

// ── sanitizeCaptionAnimation ─────────────────────────────────────────────────

describe("sanitizeCaptionAnimation", () => {
  it("non-object / missing input rehydrates to the full defaults", () => {
    expect(sanitizeCaptionAnimation(undefined)).toEqual(DEFAULT_CAPTION_ANIMATION);
    expect(sanitizeCaptionAnimation(null)).toEqual(DEFAULT_CAPTION_ANIMATION);
    expect(sanitizeCaptionAnimation("garbage")).toEqual(DEFAULT_CAPTION_ANIMATION);
  });

  it("valid persisted values pass through untouched", () => {
    const persisted = {
      type: "karaoke" as const,
      durationMs: 600,
      perWordDelayMs: 80,
      easing: "linear" as const,
      highlightColor: "#FACC15FF",
    };
    expect(sanitizeCaptionAnimation(persisted)).toEqual(persisted);
  });

  it("missing fields fall back to defaults (forward-compat contract)", () => {
    const out = sanitizeCaptionAnimation({ type: "fade" });
    expect(out.type).toBe("fade");
    expect(out.durationMs).toBe(DEFAULT_CAPTION_ANIMATION.durationMs);
    expect(out.easing).toBe(DEFAULT_CAPTION_ANIMATION.easing);
  });

  it("unknown enums reset to defaults", () => {
    const out = sanitizeCaptionAnimation({ type: "explode", easing: "bounce" } as never);
    expect(out.type).toBe(DEFAULT_CAPTION_ANIMATION.type);
    expect(out.easing).toBe(DEFAULT_CAPTION_ANIMATION.easing);
  });

  it("non-numeric numbers reset to defaults", () => {
    const out = sanitizeCaptionAnimation({
      durationMs: null,
      perWordDelayMs: NaN,
    } as never);
    expect(out.durationMs).toBe(DEFAULT_CAPTION_ANIMATION.durationMs);
    expect(out.perWordDelayMs).toBe(DEFAULT_CAPTION_ANIMATION.perWordDelayMs);
  });

  it("out-of-range numbers clamp to the limits", () => {
    const out = sanitizeCaptionAnimation({ durationMs: 9000, perWordDelayMs: -5 });
    expect(out.durationMs).toBe(ANIMATION_LIMITS.durationMs.max);
    expect(out.perWordDelayMs).toBe(ANIMATION_LIMITS.perWordDelayMs.min);
  });

  it("malformed highlightColor resets, valid one is canonicalized to uppercase", () => {
    expect(sanitizeCaptionAnimation({ highlightColor: "cyan" } as never).highlightColor).toBe(
      DEFAULT_CAPTION_ANIMATION.highlightColor,
    );
    expect(sanitizeCaptionAnimation({ highlightColor: 7 } as never).highlightColor).toBe(
      DEFAULT_CAPTION_ANIMATION.highlightColor,
    );
    expect(sanitizeCaptionAnimation({ highlightColor: "#22d3ee" }).highlightColor).toBe(
      "#22D3EEFF",
    );
  });

  it("migrates 6-digit highlightColor to opaque and preserves an 8-digit alpha", () => {
    expect(sanitizeCaptionAnimation({ highlightColor: "#facc15" }).highlightColor).toBe(
      "#FACC15FF",
    );
    expect(sanitizeCaptionAnimation({ highlightColor: "#22d3ee80" }).highlightColor).toBe(
      "#22D3EE80",
    );
  });
});
