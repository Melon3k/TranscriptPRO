import { describe, it, expect } from "vitest";
import type { CaptionStyle, CaptionBoxPosition } from "../types/captionStyle";
import {
  BOX_GRID,
  DEFAULT_CAPTION_STYLE,
  STYLE_LIMITS,
  captionBoxCss,
  captionTextCss,
  hexToCssColor,
  normalizeHexColor,
  parseHexColor,
  pointerToBoxPlacement,
  pointerToWidthPct,
  rgbaToHex8,
  sanitizeCaptionStyle,
} from "./caption-style";

function style(patch: Partial<CaptionStyle> = {}): CaptionStyle {
  return { ...DEFAULT_CAPTION_STYLE, ...patch };
}

// ── captionBoxCss ────────────────────────────────────────────────────────────

describe("captionBoxCss", () => {
  it("places the default style bottom-center", () => {
    const css = captionBoxCss(DEFAULT_CAPTION_STYLE);
    expect(css.bottom).toBe("8%");
    expect(css.left).toBe("50%");
    expect(css.transform).toBe("translateX(-50%)");
    expect(css.maxWidth).toBe("62%");
    expect(css.position).toBe("absolute");
    expect(css.pointerEvents).toBe("none");
    expect(css.userSelect).toBe("none");
  });

  it("position 1 → bottom-left", () => {
    const css = captionBoxCss(style({ boxPosition: 1 }));
    expect(css.bottom).toBe("8%");
    expect(css.left).toBe("2%");
    expect(css.transform).toBeUndefined();
  });

  it("position 3 → bottom-right", () => {
    const css = captionBoxCss(style({ boxPosition: 3 }));
    expect(css.bottom).toBe("8%");
    expect(css.right).toBe("2%");
    expect(css.transform).toBeUndefined();
  });

  it("position 5 → middle-center with dual translate", () => {
    const css = captionBoxCss(style({ boxPosition: 5 }));
    expect(css.top).toBe("50%");
    expect(css.left).toBe("50%");
    expect(css.transform).toBe("translate(-50%,-50%)");
  });

  it("positions 4 and 6 → middle with vertical translate only", () => {
    for (const pos of [4, 6] as CaptionBoxPosition[]) {
      const css = captionBoxCss(style({ boxPosition: pos }));
      expect(css.top).toBe("50%");
      expect(css.transform).toBe("translateY(-50%)");
    }
  });

  it("position 9 → top-right", () => {
    const css = captionBoxCss(style({ boxPosition: 9 }));
    expect(css.top).toBe("8%");
    expect(css.right).toBe("2%");
    expect(css.bottom).toBeUndefined();
  });

  it("uses widthPct and marginVPct", () => {
    const css = captionBoxCss(style({ widthPct: 80, marginVPct: 12 }));
    expect(css.maxWidth).toBe("80%");
    expect(css.bottom).toBe("12%");
  });
});

// ── captionTextCss ───────────────────────────────────────────────────────────

describe("captionTextCss", () => {
  it("default has the 4-layer outline shadow and no glow/shadow layer", () => {
    const css = captionTextCss(DEFAULT_CAPTION_STYLE);
    // 2px outline / 48px font ≈ 0.0417em; colors emit as rgba() for alpha.
    expect(css.textShadow).toBe(
      `-0.0417em -0.0417em 0 rgba(11,15,22,1), 0.0417em -0.0417em 0 rgba(11,15,22,1), ` +
        `-0.0417em 0.0417em 0 rgba(11,15,22,1), 0.0417em 0.0417em 0 rgba(11,15,22,1)`,
    );
    expect(css.textShadow).not.toContain("rgba(34,211,238");
    expect(css.textShadow).not.toContain("rgba(0,0,0");
  });

  it("glow:true appends the cyan glow layer last", () => {
    const css = captionTextCss(style({ glow: true }));
    const layers = String(css.textShadow).split(", ");
    expect(layers).toHaveLength(5);
    expect(layers[4]).toBe("0 0 0.25em rgba(34,211,238,1)");
  });

  it("shadow layer sits between outline and glow", () => {
    const css = captionTextCss(style({ shadow: true, glow: true }));
    const layers = String(css.textShadow).split(", ");
    expect(layers).toHaveLength(6);
    expect(layers[4]).toBe("0 0.0417em 0.0833em rgba(0,0,0,1)");
    expect(layers[5]).toBe("0 0 0.25em rgba(34,211,238,1)");
  });

  it("honors alpha in the outline color via rgba()", () => {
    const css = captionTextCss(style({ outlineColor: "#0B0F1680" }));
    expect(String(css.textShadow)).toContain("rgba(11,15,22,0.502)");
  });

  it("all effects off → textShadow undefined", () => {
    const css = captionTextCss(style({ outline: false, shadow: false, glow: false }));
    expect(css.textShadow).toBeUndefined();
  });

  it("maps bold/italic/uppercase flags to CSS", () => {
    const on = captionTextCss(style({ bold: true, italic: true, uppercase: true }));
    expect(on.fontWeight).toBe(700);
    expect(on.fontStyle).toBe("italic");
    expect(on.textTransform).toBe("uppercase");

    const off = captionTextCss(style({ bold: false, italic: false, uppercase: false }));
    expect(off.fontWeight).toBe(400);
    expect(off.fontStyle).toBe("normal");
    expect(off.textTransform).toBe("none");
  });

  it("letterSpacing 4.8 at fontSize 48 → 0.1em", () => {
    const css = captionTextCss(style({ letterSpacing: 4.8 }));
    expect(css.letterSpacing).toBe("0.1em");
  });

  it("does not set fontSize (the Player owns scaling)", () => {
    const css = captionTextCss(DEFAULT_CAPTION_STYLE);
    expect(css.fontSize).toBeUndefined();
  });

  it("uses the selected font stack and other basics", () => {
    const css = captionTextCss(style({ fontId: "JetBrains Mono" }));
    expect(css.fontFamily).toBe('"JetBrains Mono", ui-monospace, Menlo, monospace');
    expect(css.textAlign).toBe("center");
    expect(css.lineHeight).toBe(1.15);
    expect(css.color).toBe("rgba(255,255,255,1)");
    expect(css.display).toBe("block");
  });

  it("an empty/garbage family sanitizes to the default font", () => {
    // captionTextCss does not sanitize; sanitizeCaptionStyle owns the fallback.
    expect(sanitizeCaptionStyle({ fontId: "" }).fontId).toBe("Outfit");
  });

  it("preserves embedded newlines via pre-line", () => {
    const css = captionTextCss(DEFAULT_CAPTION_STYLE);
    expect(css.whiteSpace).toBe("pre-line");
  });
});

// ── style-control constants ──────────────────────────────────────────────────

describe("style-control constants", () => {
  it("BOX_GRID maps visual row-major cells to ASS numpad values", () => {
    expect(BOX_GRID).toHaveLength(9);
    expect([...BOX_GRID].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(BOX_GRID[0]).toBe(7); // top-left
    expect(BOX_GRID[7]).toBe(2); // bottom-center
  });

  it("STYLE_LIMITS ranges are sane and contain the defaults", () => {
    for (const [field, { min, max, step }] of Object.entries(STYLE_LIMITS)) {
      expect(min, field).toBeLessThan(max);
      expect(step, field).toBeGreaterThan(0);
      const value = DEFAULT_CAPTION_STYLE[field as keyof typeof STYLE_LIMITS];
      expect(value, field).toBeGreaterThanOrEqual(min);
      expect(value, field).toBeLessThanOrEqual(max);
    }
  });

  it("normalizeHexColor migrates #RRGGBB to opaque 8-digit uppercase", () => {
    expect(normalizeHexColor("#22d3ee")).toBe("#22D3EEFF");
    expect(normalizeHexColor("#FFFFFF")).toBe("#FFFFFFFF");
  });

  it("normalizeHexColor uppercases 8-digit values without touching alpha", () => {
    expect(normalizeHexColor("#22d3ee80")).toBe("#22D3EE80");
    expect(normalizeHexColor("#0b0f16ff")).toBe("#0B0F16FF");
  });

  it("normalizeHexColor returns malformed inputs unchanged", () => {
    expect(normalizeHexColor("oops")).toBe("oops");
    expect(normalizeHexColor("#12345")).toBe("#12345");
    expect(normalizeHexColor("")).toBe("");
  });
});

// ── color-model helpers ──────────────────────────────────────────────────────

describe("parseHexColor", () => {
  it("parses 6-digit as fully opaque (a=255)", () => {
    expect(parseHexColor("#22D3EE")).toEqual({ r: 34, g: 211, b: 238, a: 255 });
  });

  it("parses 8-digit including the alpha byte, case-insensitive", () => {
    expect(parseHexColor("#22d3ee80")).toEqual({ r: 34, g: 211, b: 238, a: 128 });
    expect(parseHexColor("#00000000")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("returns null for malformed input", () => {
    expect(parseHexColor("red")).toBeNull();
    expect(parseHexColor("#12345")).toBeNull();
    expect(parseHexColor("#1234567")).toBeNull();
    expect(parseHexColor("")).toBeNull();
  });
});

describe("rgbaToHex8", () => {
  it("composes an uppercase zero-padded #RRGGBBAA", () => {
    expect(rgbaToHex8(34, 211, 238, 255)).toBe("#22D3EEFF");
    expect(rgbaToHex8(0, 0, 0, 0)).toBe("#00000000");
    expect(rgbaToHex8(1, 2, 3, 4)).toBe("#01020304");
  });

  it("clamps out-of-range channels to 0–255", () => {
    expect(rgbaToHex8(-10, 300, 128, 999)).toBe("#00FF80FF");
  });

  it("never emits NaN for non-finite channels", () => {
    expect(rgbaToHex8(NaN, Infinity, -Infinity, NaN)).toBe("#00FF0000");
  });
});

describe("hexToCssColor", () => {
  it("emits rgba() with alpha as a 0..1 decimal", () => {
    expect(hexToCssColor("#22D3EE80")).toBe("rgba(34,211,238,0.502)");
    expect(hexToCssColor("#FFFFFFFF")).toBe("rgba(255,255,255,1)");
    expect(hexToCssColor("#22D3EE")).toBe("rgba(34,211,238,1)");
  });

  it("falls back to opaque black on invalid input", () => {
    expect(hexToCssColor("garbage")).toBe("rgba(0,0,0,1)");
    expect(hexToCssColor("")).toBe("rgba(0,0,0,1)");
  });
});

// ── pointerToBoxPlacement ────────────────────────────────────────────────────

describe("pointerToBoxPlacement", () => {
  it("snaps X to the three ASS columns at each vertical band", () => {
    // bottom band (rows 1–3)
    expect(pointerToBoxPlacement(0.1, 0.9, DEFAULT_CAPTION_STYLE).boxPosition).toBe(1);
    expect(pointerToBoxPlacement(0.5, 0.9, DEFAULT_CAPTION_STYLE).boxPosition).toBe(2);
    expect(pointerToBoxPlacement(0.9, 0.9, DEFAULT_CAPTION_STYLE).boxPosition).toBe(3);
    // middle band (rows 4–6)
    expect(pointerToBoxPlacement(0.1, 0.5, DEFAULT_CAPTION_STYLE).boxPosition).toBe(4);
    expect(pointerToBoxPlacement(0.5, 0.5, DEFAULT_CAPTION_STYLE).boxPosition).toBe(5);
    expect(pointerToBoxPlacement(0.9, 0.5, DEFAULT_CAPTION_STYLE).boxPosition).toBe(6);
    // top band (rows 7–9)
    expect(pointerToBoxPlacement(0.1, 0.1, DEFAULT_CAPTION_STYLE).boxPosition).toBe(7);
    expect(pointerToBoxPlacement(0.5, 0.1, DEFAULT_CAPTION_STYLE).boxPosition).toBe(8);
    expect(pointerToBoxPlacement(0.9, 0.1, DEFAULT_CAPTION_STYLE).boxPosition).toBe(9);
  });

  it("bottom band derives marginVPct from distance to the bottom edge, clamped", () => {
    expect(pointerToBoxPlacement(0.5, 0.95, DEFAULT_CAPTION_STYLE).marginVPct).toBe(5);
    // bottom band is cy >= 2/3; (1-0.68)*100 = 32 → clamps to max 30
    expect(pointerToBoxPlacement(0.5, 0.68, DEFAULT_CAPTION_STYLE).marginVPct).toBe(30);
  });

  it("top band derives marginVPct from distance to the top edge, clamped", () => {
    expect(pointerToBoxPlacement(0.5, 0.05, DEFAULT_CAPTION_STYLE).marginVPct).toBe(5);
    // top band is cy < 1/3; 0.32*100 = 32 → clamps to max 30
    expect(pointerToBoxPlacement(0.5, 0.32, DEFAULT_CAPTION_STYLE).marginVPct).toBe(30);
  });

  it("middle band preserves the current marginVPct unchanged", () => {
    expect(pointerToBoxPlacement(0.5, 0.5, style({ marginVPct: 12 })).marginVPct).toBe(12);
  });

  it("marginVPct is always a multiple of the slider step", () => {
    const step = STYLE_LIMITS.marginVPct.step;
    for (const ry of [0.02, 0.17, 0.29, 0.71, 0.83, 0.96]) {
      const { marginVPct } = pointerToBoxPlacement(0.5, ry, DEFAULT_CAPTION_STYLE);
      expect(Number.isInteger(marginVPct / step)).toBe(true);
    }
  });
});

// ── pointerToWidthPct ────────────────────────────────────────────────────────

describe("pointerToWidthPct", () => {
  it("center column widens symmetrically about the frame center", () => {
    expect(pointerToWidthPct(0.75, DEFAULT_CAPTION_STYLE)).toBe(50);
    // |0.5-0.5|*2*100 = 0 → clamps to min 20
    expect(pointerToWidthPct(0.5, DEFAULT_CAPTION_STYLE)).toBe(STYLE_LIMITS.widthPct.min);
    // near right edge → clamps to max 100
    expect(pointerToWidthPct(1, DEFAULT_CAPTION_STYLE)).toBe(STYLE_LIMITS.widthPct.max);
  });

  it("left column measures from the 2% left anchor", () => {
    // (0.62-0.02)*100 = 60
    expect(pointerToWidthPct(0.62, style({ boxPosition: 1 }))).toBe(60);
  });

  it("right column measures back to the 2% right anchor", () => {
    // (0.98-0.38)*100 = 60
    expect(pointerToWidthPct(0.38, style({ boxPosition: 3 }))).toBe(60);
  });

  it("result is always an integer within 20–100", () => {
    for (const rx of [0, 0.13, 0.37, 0.62, 0.88, 1]) {
      const w = pointerToWidthPct(rx, DEFAULT_CAPTION_STYLE);
      expect(Number.isInteger(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(STYLE_LIMITS.widthPct.min);
      expect(w).toBeLessThanOrEqual(STYLE_LIMITS.widthPct.max);
    }
  });
});

// ── sanitizeCaptionStyle ─────────────────────────────────────────────────────

describe("sanitizeCaptionStyle", () => {
  it("non-object / missing input rehydrates to the full defaults", () => {
    expect(sanitizeCaptionStyle(undefined)).toEqual(DEFAULT_CAPTION_STYLE);
    expect(sanitizeCaptionStyle(null)).toEqual(DEFAULT_CAPTION_STYLE);
    expect(sanitizeCaptionStyle("garbage")).toEqual(DEFAULT_CAPTION_STYLE);
  });

  it("valid persisted values pass through untouched", () => {
    const persisted = style({ fontSize: 72, bold: false, textColor: "#FACC15FF" });
    expect(sanitizeCaptionStyle(persisted)).toEqual(persisted);
  });

  it("migrates persisted 6-digit colors to opaque 8-digit (no version bump)", () => {
    const out = sanitizeCaptionStyle({
      textColor: "#FACC15",
      outlineColor: "#0b0f16",
      shadowColor: "#000000",
      glowColor: "#22d3ee",
    });
    expect(out.textColor).toBe("#FACC15FF");
    expect(out.outlineColor).toBe("#0B0F16FF");
    expect(out.shadowColor).toBe("#000000FF");
    expect(out.glowColor).toBe("#22D3EEFF");
  });

  it("preserves an explicit alpha byte on 8-digit colors", () => {
    const out = sanitizeCaptionStyle({ textColor: "#ffffff80" });
    expect(out.textColor).toBe("#FFFFFF80");
  });

  it("missing fields fall back to defaults (forward-compat contract)", () => {
    const out = sanitizeCaptionStyle({ fontSize: 60 });
    expect(out.fontSize).toBe(60);
    expect(out.fontId).toBe(DEFAULT_CAPTION_STYLE.fontId);
    expect(out.widthPct).toBe(DEFAULT_CAPTION_STYLE.widthPct);
  });

  it("non-numeric numeric fields reset to defaults (fontSize:null → no NaNem)", () => {
    const out = sanitizeCaptionStyle({
      fontSize: null,
      letterSpacing: "wide",
      lineHeight: NaN,
      widthPct: Infinity,
    } as never);
    expect(out.fontSize).toBe(DEFAULT_CAPTION_STYLE.fontSize);
    expect(out.letterSpacing).toBe(DEFAULT_CAPTION_STYLE.letterSpacing);
    expect(out.lineHeight).toBe(DEFAULT_CAPTION_STYLE.lineHeight);
    expect(out.widthPct).toBe(DEFAULT_CAPTION_STYLE.widthPct);
    expect(captionTextCss(out).letterSpacing).not.toContain("NaN");
  });

  it("out-of-range numbers clamp to the slider limits", () => {
    const out = sanitizeCaptionStyle({ widthPct: 400, fontSize: 4, marginVPct: -10 });
    expect(out.widthPct).toBe(STYLE_LIMITS.widthPct.max);
    expect(out.fontSize).toBe(STYLE_LIMITS.fontSize.min);
    expect(out.marginVPct).toBe(STYLE_LIMITS.marginVPct.min);
  });

  it("non-boolean flags reset to defaults", () => {
    const out = sanitizeCaptionStyle({ bold: "yes", glow: 1, shadow: null } as never);
    expect(out.bold).toBe(DEFAULT_CAPTION_STYLE.bold);
    expect(out.glow).toBe(DEFAULT_CAPTION_STYLE.glow);
    expect(out.shadow).toBe(DEFAULT_CAPTION_STYLE.shadow);
  });

  it("malformed colors reset, valid ones are canonicalized to uppercase", () => {
    const out = sanitizeCaptionStyle({
      textColor: "red",
      outlineColor: 7,
      glowColor: "#22d3ee",
    } as never);
    expect(out.textColor).toBe(DEFAULT_CAPTION_STYLE.textColor);
    expect(out.outlineColor).toBe(DEFAULT_CAPTION_STYLE.outlineColor);
    expect(out.glowColor).toBe("#22D3EEFF");
  });

  it("unknown enums reset to defaults", () => {
    const out = sanitizeCaptionStyle({
      fontId: "poppins",
      align: "justify",
      boxPosition: 12,
    } as never);
    // fontId is now a free family name — a system family is valid, not reset.
    expect(out.fontId).toBe("poppins");
    expect(out.align).toBe(DEFAULT_CAPTION_STYLE.align);
    expect(out.boxPosition).toBe(DEFAULT_CAPTION_STYLE.boxPosition);
  });

  it("migrates legacy fontId ids and validates family strings", () => {
    expect(sanitizeCaptionStyle({ fontId: "outfit" }).fontId).toBe("Outfit");
    expect(sanitizeCaptionStyle({ fontId: "jetbrains-mono" }).fontId).toBe("JetBrains Mono");
    expect(sanitizeCaptionStyle({ fontId: "" }).fontId).toBe("Outfit");
    expect(sanitizeCaptionStyle({ fontId: 7 as never }).fontId).toBe("Outfit");
  });
});
