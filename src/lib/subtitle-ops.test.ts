import { describe, it, expect } from "vitest";
import type { Subtitle, Word } from "../types/subtitle";
import {
  resegmentByLength,
  splitSegment,
  mergeSegments,
  type SegmentLimit,
} from "./subtitle-ops";

// ── Helpers ──────────────────────────────────────────────────────────────────

let idCounter = 0;
function nextId(): string {
  return `seg-${idCounter++}`;
}

/** Build aligned word timings for the given tokens (10ms gap, no >=250ms pause). */
function makeWords(tokens: string[], start = 0, step = 100): Word[] {
  return tokens.map((text, i) => ({
    text,
    startTime: start + i * step,
    endTime: start + i * step + (step - 10),
  }));
}

interface SegOpts {
  words?: Word[];
  aligned?: boolean; // when true, build 1:1 words from the text
  startTime?: number;
  endTime?: number;
}

function makeSeg(text: string, opts: SegOpts = {}): Subtitle {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const words =
    opts.words ?? (opts.aligned ? makeWords(tokens) : []);
  return {
    id: nextId(),
    index: 1,
    startTime: opts.startTime ?? 0,
    endTime: opts.endTime ?? Math.max(1000, tokens.length * 100),
    text,
    words,
    speaker: undefined,
  };
}

/** Normalised whitespace-joined text, for order-preserving comparisons. */
function norm(s: string): string {
  return s.trim().split(/\s+/).filter(Boolean).join(" ");
}

function joinTexts(subs: Subtitle[]): string {
  return norm(subs.map((s) => s.text).join(" "));
}

function tokenCount(s: Subtitle): number {
  return s.text.trim().split(/\s+/).filter(Boolean).length;
}

const WORDS2: SegmentLimit = { mode: "words", value: 2 };
const WORDS3: SegmentLimit = { mode: "words", value: 3 };

// ── resegmentByLength: hard cap ──────────────────────────────────────────────

describe("resegmentByLength — hard cap", () => {
  it("caps every piece at the word limit (2 words over 7)", () => {
    const seg = makeSeg("one two three four five six seven", { aligned: true });
    const out = resegmentByLength([seg], WORDS2);
    expect(out.length).toBeGreaterThan(1);
    for (const piece of out) {
      expect(tokenCount(piece)).toBeLessThanOrEqual(2);
    }
    // Text is preserved end to end.
    expect(joinTexts(out)).toBe("one two three four five six seven");
  });
});

// ── resegmentByLength: connectives ────────────────────────────────────────────

describe("resegmentByLength — connectives", () => {
  it("never ends a piece on a lowercase connective and never strands it", () => {
    // "na" is a short lowercase function word; the balanced 2+3 cut would end a
    // piece on it, so the DP must prefer 3+2 instead.
    const seg = makeSeg("klik na duży czerwony przycisk", { aligned: true });
    const out = resegmentByLength([seg], WORDS3);
    for (const piece of out) {
      const toks = piece.text.trim().split(/\s+/);
      expect(toks[toks.length - 1]).not.toBe("na"); // never ends a line
      expect(piece.text.trim()).not.toBe("na"); // never stands alone
    }
    expect(joinTexts(out)).toBe("klik na duży czerwony przycisk");
  });

  it("keeps a trailing lowercase connective attached to its neighbour", () => {
    // With the strong-punctuation cut after "dd." the balanced choice would
    // strand the last token; a connective must resist that (lone penalty).
    const seg = makeSeg("aaaa bbbb cccc dd. i", { aligned: true });
    const out = resegmentByLength([seg], WORDS2);
    const last = out[out.length - 1];
    expect(last.text.trim()).not.toBe("i"); // "i" is not left on its own line
    expect(joinTexts(out)).toBe("aaaa bbbb cccc dd. i");
  });

  it("lets a capitalised short word stand on its own (not treated as a connective)", () => {
    // Same shape as above but the short word starts with an uppercase letter —
    // it is content, not a function word, so it may end/own a line.
    const seg = makeSeg("aaaa bbbb cccc dd. USA", { aligned: true });
    const out = resegmentByLength([seg], WORDS2);
    const last = out[out.length - 1];
    expect(last.text.trim()).toBe("USA");
    expect(joinTexts(out)).toBe("aaaa bbbb cccc dd. USA");
  });

  it("lets a short number stand on its own (not treated as a connective)", () => {
    const seg = makeSeg("aaaa bbbb cccc dd. 42", { aligned: true });
    const out = resegmentByLength([seg], WORDS2);
    const last = out[out.length - 1];
    expect(last.text.trim()).toBe("42");
    expect(joinTexts(out)).toBe("aaaa bbbb cccc dd. 42");
  });
});

// ── resegmentByLength: idempotency & no-ops ───────────────────────────────────

describe("resegmentByLength — idempotency and no-ops", () => {
  it("is idempotent: a second pass is a no-op returning the same reference", () => {
    const seg = makeSeg("one two three four five six seven", { aligned: true });
    const first = resegmentByLength([seg], WORDS2);
    const second = resegmentByLength(first, WORDS2);
    expect(second).toBe(first); // same array reference — nothing left to split
  });

  it("returns the input unchanged when nothing exceeds the limit", () => {
    const input = [makeSeg("short enough", { aligned: true })];
    const out = resegmentByLength(input, WORDS3);
    expect(out).toBe(input);
  });

  it("is a no-op for a single-word segment", () => {
    const input = [makeSeg("word", { aligned: true })];
    const out = resegmentByLength(input, WORDS2);
    expect(out).toBe(input);
  });

  it("is a no-op for an empty segment", () => {
    const input = [makeSeg("", {})];
    const out = resegmentByLength(input, WORDS2);
    expect(out).toBe(input);
  });

  it("ignores invalid limits", () => {
    const input = [makeSeg("one two three four five", { aligned: true })];
    expect(resegmentByLength(input, { mode: "words", value: 0 })).toBe(input);
    expect(resegmentByLength(input, { mode: "words", value: NaN })).toBe(input);
  });
});

// ── resegmentByLength: text preservation across timing modes ──────────────────

describe("resegmentByLength — text preservation", () => {
  const text = "alpha beta gamma delta epsilon zeta";

  it("preserves text with aligned word timings", () => {
    const seg = makeSeg(text, { aligned: true });
    const out = resegmentByLength([seg], WORDS2);
    expect(joinTexts(out)).toBe(text);
  });

  it("preserves text when the text was edited (words no longer 1:1)", () => {
    // Simulate a post-transcription edit: text has 6 tokens but only 3 words.
    const seg = makeSeg(text, { words: makeWords(["alpha", "gamma", "zeta"]) });
    const out = resegmentByLength([seg], WORDS2);
    expect(out.length).toBeGreaterThan(1);
    expect(joinTexts(out)).toBe(text);
  });

  it("preserves text when there are no word timestamps (SRT import)", () => {
    const seg = makeSeg(text, { words: [] });
    const out = resegmentByLength([seg], WORDS2);
    expect(out.length).toBeGreaterThan(1);
    expect(joinTexts(out)).toBe(text);
  });

  it("keeps timestamps within the original segment bounds", () => {
    const seg = makeSeg(text, { aligned: true, startTime: 500, endTime: 4000 });
    const out = resegmentByLength([seg], WORDS2);
    for (const piece of out) {
      expect(piece.startTime).toBeGreaterThanOrEqual(500);
      expect(piece.endTime).toBeLessThanOrEqual(4000);
      expect(piece.endTime).toBeGreaterThanOrEqual(piece.startTime);
    }
  });
});

// ── splitSegment ──────────────────────────────────────────────────────────────

describe("splitSegment", () => {
  it("splits a multi-word segment into two, preserving text", () => {
    const seg = makeSeg("hello brave new world", { aligned: true });
    const out = splitSegment([seg], seg.id);
    expect(out).toHaveLength(2);
    expect(joinTexts(out)).toBe("hello brave new world");
    // Indices are renumbered from 1.
    expect(out.map((s) => s.index)).toEqual([1, 2]);
  });

  it("is a no-op (same reference) for a single-word segment", () => {
    const input = [makeSeg("word", { aligned: true })];
    const out = splitSegment(input, input[0].id);
    expect(out).toBe(input);
  });

  it("is a no-op for an empty segment", () => {
    const input = [makeSeg("", {})];
    const out = splitSegment(input, input[0].id);
    expect(out).toBe(input);
  });

  it("returns the input unchanged for an unknown id", () => {
    const input = [makeSeg("hello world", { aligned: true })];
    const out = splitSegment(input, "does-not-exist");
    expect(out).toBe(input);
  });
});

// ── mergeSegments ─────────────────────────────────────────────────────────────

describe("mergeSegments", () => {
  it("merges a segment with the one below it", () => {
    const a = makeSeg("hello there", { aligned: true, startTime: 0, endTime: 900 });
    const b = makeSeg("general kenobi", {
      aligned: true,
      startTime: 1000,
      endTime: 1900,
    });
    const out = mergeSegments([a, b], a.id, "down");
    expect(out).toHaveLength(1);
    expect(norm(out[0].text)).toBe("hello there general kenobi");
    expect(out[0].startTime).toBe(0);
    expect(out[0].endTime).toBe(1900);
    expect(out[0].words).toHaveLength(a.words.length + b.words.length);
    expect(out[0].index).toBe(1);
  });

  it("merges a segment with the one above it", () => {
    const a = makeSeg("hello there", { aligned: true, startTime: 0, endTime: 900 });
    const b = makeSeg("general kenobi", {
      aligned: true,
      startTime: 1000,
      endTime: 1900,
    });
    const out = mergeSegments([a, b], b.id, "up");
    expect(out).toHaveLength(1);
    expect(norm(out[0].text)).toBe("hello there general kenobi");
    expect(out[0].startTime).toBe(0);
    expect(out[0].endTime).toBe(1900);
  });

  it("is a no-op when merging past the boundary", () => {
    const a = makeSeg("first", { aligned: true });
    const b = makeSeg("second", { aligned: true });
    const input = [a, b];
    expect(mergeSegments(input, a.id, "up")).toBe(input); // nothing above
    expect(mergeSegments(input, b.id, "down")).toBe(input); // nothing below
  });
});
