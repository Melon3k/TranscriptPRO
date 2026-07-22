import { describe, it, expect } from "vitest";
import { EXPORTED_ANIMATIONS } from "../types/captionStyle";
import {
  ANIMATION_LIMITS,
  ANIMATION_TYPES,
  DEFAULT_CAPTION_ANIMATION,
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

  it("default type is a member of its union", () => {
    expect(ANIMATION_TYPES).toContain(DEFAULT_CAPTION_ANIMATION.type);
  });

  it("all types except none export to ASS", () => {
    expect([...EXPORTED_ANIMATIONS].sort()).toEqual([
      "blur",
      "fade",
      "karaoke",
      "pop",
      "slide",
      "typewriter",
    ]);
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
      highlightColor: "#FACC15FF",
    };
    expect(sanitizeCaptionAnimation(persisted)).toEqual(persisted);
  });

  it("legacy preview-only keys (perWordDelayMs/easing) don't break sanitize", () => {
    // sanitize merges over defaults (doesn't whitelist), so stray legacy keys
    // may ride along harmlessly — TS never reads them and Rust serde ignores
    // unknown fields. What matters: the known contract fields are correct.
    const out = sanitizeCaptionAnimation({
      type: "fade",
      durationMs: 500,
      perWordDelayMs: 80,
      easing: "linear",
    } as never);
    expect(out.type).toBe("fade");
    expect(out.durationMs).toBe(500);
    expect(out.highlightColor).toBe(DEFAULT_CAPTION_ANIMATION.highlightColor);
  });

  it("missing fields fall back to defaults (forward-compat contract)", () => {
    const out = sanitizeCaptionAnimation({ type: "fade" });
    expect(out.type).toBe("fade");
    expect(out.durationMs).toBe(DEFAULT_CAPTION_ANIMATION.durationMs);
  });

  it("unknown type resets to default", () => {
    const out = sanitizeCaptionAnimation({ type: "explode" } as never);
    expect(out.type).toBe(DEFAULT_CAPTION_ANIMATION.type);
  });

  it("non-numeric duration resets to default", () => {
    const out = sanitizeCaptionAnimation({ durationMs: null } as never);
    expect(out.durationMs).toBe(DEFAULT_CAPTION_ANIMATION.durationMs);
  });

  it("out-of-range duration clamps to the limits", () => {
    const out = sanitizeCaptionAnimation({ durationMs: 9000 });
    expect(out.durationMs).toBe(ANIMATION_LIMITS.durationMs.max);
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
