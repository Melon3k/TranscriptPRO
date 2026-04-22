import { Subtitle, Word } from "../types/subtitle";

/**
 * Re-number all subtitles sequentially from 1.
 */
export function reindex(subtitles: Subtitle[]): Subtitle[] {
  return subtitles.map((s, i) => ({ ...s, index: i + 1 }));
}

/**
 * Generate a simple unique ID (crypto.randomUUID with fallback).
 */
export function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Split a subtitle segment into two parts at the midpoint.
 *
 * Rules:
 * - Never split in the middle of a word.
 * - If word-level timestamps are available: split at the nearest word boundary
 *   to the midpoint, using word timestamps for accurate split time.
 * - Fallback: find the nearest space character from the midpoint of the text,
 *   and interpolate the split timestamp proportionally.
 */
export function splitSegment(subtitles: Subtitle[], id: string): Subtitle[] {
  const idx = subtitles.findIndex((s) => s.id === id);
  if (idx === -1) return subtitles;

  const seg = subtitles[idx];

  // ── Word-level split (precise) ──────────────────────────────────────
  if (seg.words.length >= 2) {
    const midWordIdx = Math.ceil(seg.words.length / 2);
    const firstWords = seg.words.slice(0, midWordIdx);
    const secondWords = seg.words.slice(midWordIdx);

    if (firstWords.length === 0 || secondWords.length === 0) {
      return subtitles; // can't split single word
    }

    const splitTime = secondWords[0].startTime;

    const first: Subtitle = {
      id: generateId(),
      index: 0,
      startTime: seg.startTime,
      endTime: splitTime,
      text: wordsToText(firstWords),
      words: firstWords,
    };

    const second: Subtitle = {
      id: generateId(),
      index: 0,
      startTime: splitTime,
      endTime: seg.endTime,
      text: wordsToText(secondWords),
      words: secondWords,
    };

    return reindex([
      ...subtitles.slice(0, idx),
      first,
      second,
      ...subtitles.slice(idx + 1),
    ]);
  }

  // ── Text-based split (fallback) ──────────────────────────────────────
  const text = seg.text;
  if (text.trim().length === 0) return subtitles;

  const midChar = Math.floor(text.length / 2);
  const splitChar = findNearestWordBoundary(text, midChar);

  if (splitChar <= 0 || splitChar >= text.length) return subtitles;

  const firstText = text.slice(0, splitChar).trimEnd();
  const secondText = text.slice(splitChar).trimStart();

  if (!firstText || !secondText) return subtitles;

  const ratio = splitChar / text.length;
  const duration = seg.endTime - seg.startTime;
  const splitTime = seg.startTime + Math.round(duration * ratio);

  const first: Subtitle = {
    id: generateId(),
    index: 0,
    startTime: seg.startTime,
    endTime: splitTime,
    text: firstText,
    words: [],
  };

  const second: Subtitle = {
    id: generateId(),
    index: 0,
    startTime: splitTime,
    endTime: seg.endTime,
    text: secondText,
    words: [],
  };

  return reindex([
    ...subtitles.slice(0, idx),
    first,
    second,
    ...subtitles.slice(idx + 1),
  ]);
}

/**
 * Merge a subtitle with its neighbour.
 * direction = "up"   → merge current with segment above (current takes prev's startTime)
 * direction = "down" → merge current with segment below (current takes next's endTime)
 */
export function mergeSegments(
  subtitles: Subtitle[],
  id: string,
  direction: "up" | "down"
): Subtitle[] {
  const idx = subtitles.findIndex((s) => s.id === id);
  if (idx === -1) return subtitles;

  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= subtitles.length) return subtitles;

  const first = subtitles[Math.min(idx, targetIdx)];
  const second = subtitles[Math.max(idx, targetIdx)];

  const merged: Subtitle = {
    id: generateId(),
    index: 0,
    startTime: first.startTime,
    endTime: second.endTime,
    text: `${first.text} ${second.text}`.trim(),
    words: [...first.words, ...second.words],
  };

  const minIdx = Math.min(idx, targetIdx);
  return reindex([
    ...subtitles.slice(0, minIdx),
    merged,
    ...subtitles.slice(minIdx + 2),
  ]);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Find the nearest space character to `pos` in `text`,
 * searching outward from `pos` in both directions.
 * Returns the index of the space (split before it), or -1 if none found.
 */
function findNearestWordBoundary(text: string, pos: number): number {
  let left = pos;
  let right = pos;

  while (left > 0 || right < text.length) {
    if (right < text.length) {
      if (text[right] === " ") return right;
      right++;
    }
    if (left > 0) {
      left--;
      if (text[left] === " ") return left;
    }
  }
  return -1;
}

export function wordsToText(words: Word[]): string {
  return words
    .map((w) => w.text)
    .join(" ")
    .trim();
}
