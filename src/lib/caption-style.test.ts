import { describe, it, expect } from "vitest";
import type { CaptionStyle, CaptionBoxPosition } from "../types/captionStyle";
import {
  DEFAULT_CAPTION_STYLE,
  captionBoxCss,
  captionTextCss,
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
