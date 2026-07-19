import { describe, it, expect } from "vitest";
import type { CaptionStyle } from "../types/captionStyle";
import { DEFAULT_CAPTION_STYLE, sanitizeCaptionStyle } from "./caption-style";
import {
  BUILTIN_PRESETS,
  newPresetId,
  sanitizePreset,
  stylesEqual,
  uniquePresetName,
} from "./caption-presets";

function style(patch: Partial<CaptionStyle> = {}): CaptionStyle {
  return { ...DEFAULT_CAPTION_STYLE, ...patch };
}

// ── BUILTIN_PRESETS ──────────────────────────────────────────────────────────

describe("BUILTIN_PRESETS", () => {
  it("has the four expected built-ins with builtin: ids and i18n name keys", () => {
    expect(BUILTIN_PRESETS.map((p) => p.id)).toEqual([
      "builtin:neon",
      "builtin:hardShadow",
      "builtin:thickOutline",
      "builtin:soft",
    ]);
    for (const p of BUILTIN_PRESETS) {
      expect(p.nameKey).toMatch(/^style:presets\.builtin\./);
    }
  });

  it("every built-in style is in range (unchanged by sanitizeCaptionStyle)", () => {
    for (const p of BUILTIN_PRESETS) {
      expect(sanitizeCaptionStyle(p.style)).toEqual(p.style);
    }
  });
});

// ── stylesEqual ──────────────────────────────────────────────────────────────

describe("stylesEqual", () => {
  it("true for a clone", () => {
    expect(stylesEqual(DEFAULT_CAPTION_STYLE, { ...DEFAULT_CAPTION_STYLE })).toBe(true);
  });

  it("false when any single field differs", () => {
    expect(stylesEqual(DEFAULT_CAPTION_STYLE, style({ fontSize: 49 }))).toBe(false);
    expect(stylesEqual(DEFAULT_CAPTION_STYLE, style({ bold: !DEFAULT_CAPTION_STYLE.bold }))).toBe(false);
    expect(stylesEqual(DEFAULT_CAPTION_STYLE, style({ textColor: "#000000" }))).toBe(false);
    expect(stylesEqual(DEFAULT_CAPTION_STYLE, style({ boxPosition: 5 }))).toBe(false);
  });
});

// ── sanitizePreset ───────────────────────────────────────────────────────────

describe("sanitizePreset", () => {
  it("returns null for non-objects", () => {
    expect(sanitizePreset(null)).toBeNull();
    expect(sanitizePreset(undefined)).toBeNull();
    expect(sanitizePreset("x")).toBeNull();
    expect(sanitizePreset(42)).toBeNull();
  });

  it("returns null when name is missing or empty/whitespace", () => {
    expect(sanitizePreset({ style: DEFAULT_CAPTION_STYLE })).toBeNull();
    expect(sanitizePreset({ name: "", style: DEFAULT_CAPTION_STYLE })).toBeNull();
    expect(sanitizePreset({ name: "   ", style: DEFAULT_CAPTION_STYLE })).toBeNull();
    expect(sanitizePreset({ name: 7, style: DEFAULT_CAPTION_STYLE })).toBeNull();
  });

  it("rebuilds a valid preset, sanitizing a bad style field to default", () => {
    const out = sanitizePreset({
      id: "abc",
      name: "My preset",
      style: { ...DEFAULT_CAPTION_STYLE, fontSize: null },
    });
    expect(out).not.toBeNull();
    expect(out!.id).toBe("abc");
    expect(out!.name).toBe("My preset");
    expect(out!.style.fontSize).toBe(DEFAULT_CAPTION_STYLE.fontSize);
    expect(out!.style).toEqual(DEFAULT_CAPTION_STYLE);
  });

  it("mints a fresh id when id is missing or not a non-empty string", () => {
    const a = sanitizePreset({ name: "n", style: DEFAULT_CAPTION_STYLE });
    const b = sanitizePreset({ id: "", name: "n", style: DEFAULT_CAPTION_STYLE });
    expect(a!.id).toBeTruthy();
    expect(typeof a!.id).toBe("string");
    expect(b!.id).toBeTruthy();
  });

  it("rebuilds the full default style when style is absent", () => {
    const out = sanitizePreset({ name: "n" });
    expect(out!.style).toEqual(DEFAULT_CAPTION_STYLE);
  });
});

// ── newPresetId ──────────────────────────────────────────────────────────────

describe("newPresetId", () => {
  it("returns distinct non-empty strings", () => {
    const a = newPresetId();
    const b = newPresetId();
    expect(typeof a).toBe("string");
    expect(a).not.toBe("");
    expect(a).not.toBe(b);
  });
});

// ── uniquePresetName ─────────────────────────────────────────────────────────

describe("uniquePresetName", () => {
  it("returns the base when unused", () => {
    expect(uniquePresetName("Neon", [])).toBe("Neon");
    expect(uniquePresetName("Neon", ["Other"])).toBe("Neon");
  });

  it("appends ' 2', ' 3' on collision", () => {
    expect(uniquePresetName("Neon", ["Neon"])).toBe("Neon 2");
    expect(uniquePresetName("Neon", ["Neon", "Neon 2"])).toBe("Neon 3");
  });

  it("compares case-insensitively", () => {
    expect(uniquePresetName("Neon", ["neon"])).toBe("Neon 2");
    expect(uniquePresetName("Neon", ["NEON", "neon 2"])).toBe("Neon 3");
  });
});
