import { describe, it, expect } from "vitest";
import type { CaptionStyle, CaptionBoxPosition } from "../types/captionStyle";
import {
  BOX_GRID,
  DEFAULT_CAPTION_STYLE,
  STYLE_LIMITS,
  captionBoxCss,
  captionTextCss,
  normalizeHexColor,
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
    // 2px outline / 48px font ≈ 0.0417em
    expect(css.textShadow).toBe(
      `-0.0417em -0.0417em 0 #0B0F16, 0.0417em -0.0417em 0 #0B0F16, ` +
        `-0.0417em 0.0417em 0 #0B0F16, 0.0417em 0.0417em 0 #0B0F16`,
    );
    expect(css.textShadow).not.toContain("#22D3EE");
    expect(css.textShadow).not.toContain("#000000");
  });

  it("glow:true appends the cyan glow layer last", () => {
    const css = captionTextCss(style({ glow: true }));
    const layers = String(css.textShadow).split(", ");
    expect(layers).toHaveLength(5);
    expect(layers[4]).toBe("0 0 0.25em #22D3EE");
  });

  it("shadow layer sits between outline and glow", () => {
    const css = captionTextCss(style({ shadow: true, glow: true }));
    const layers = String(css.textShadow).split(", ");
    expect(layers).toHaveLength(6);
    expect(layers[4]).toBe("0 0.0417em 0.0833em #000000");
    expect(layers[5]).toBe("0 0 0.25em #22D3EE");
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
    const css = captionTextCss(style({ fontId: "jetbrains-mono" }));
    expect(css.fontFamily).toBe('"JetBrains Mono", ui-monospace, Menlo, monospace');
    expect(css.textAlign).toBe("center");
    expect(css.lineHeight).toBe(1.15);
    expect(css.color).toBe("#FFFFFF");
    expect(css.display).toBe("block");
  });

  it("unknown fontId falls back to the default font instead of throwing", () => {
    const css = captionTextCss(style({ fontId: "poppins" as never }));
    expect(css.fontFamily).toBe('"Outfit", system-ui, sans-serif');
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

  it("normalizeHexColor uppercases valid #RRGGBB values", () => {
    expect(normalizeHexColor("#22d3ee")).toBe("#22D3EE");
    expect(normalizeHexColor("#FFFFFF")).toBe("#FFFFFF");
  });

  it("normalizeHexColor returns malformed inputs unchanged", () => {
    expect(normalizeHexColor("oops")).toBe("oops");
    expect(normalizeHexColor("#12345")).toBe("#12345");
    expect(normalizeHexColor("")).toBe("");
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
    const persisted = style({ fontSize: 72, bold: false, textColor: "#FACC15" });
    expect(sanitizeCaptionStyle(persisted)).toEqual(persisted);
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
    expect(out.glowColor).toBe("#22D3EE");
  });

  it("unknown enums reset to defaults", () => {
    const out = sanitizeCaptionStyle({
      fontId: "poppins",
      align: "justify",
      boxPosition: 12,
    } as never);
    expect(out.fontId).toBe(DEFAULT_CAPTION_STYLE.fontId);
    expect(out.align).toBe(DEFAULT_CAPTION_STYLE.align);
    expect(out.boxPosition).toBe(DEFAULT_CAPTION_STYLE.boxPosition);
  });
});
