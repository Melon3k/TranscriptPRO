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
 * - Never split in the middle of a word, and never lose or rewrite text: both
 *   halves are cut from the segment's *current* text (which may have been
 *   edited), while `words[]` is used only for timing.
 * - If words match the text one-to-one, the split lands exactly on the spoken
 *   word boundary; after a text edit the timings are kept by distributing
 *   words proportionally instead of dropping them.
 */
export function splitSegment(subtitles: Subtitle[], id: string): Subtitle[] {
  const idx = subtitles.findIndex((s) => s.id === id);
  if (idx === -1) return subtitles;

  const seg = subtitles[idx];
  const tokens = seg.text.trim().split(/\s+/).filter(Boolean);
  const halves = splitSegmentText(seg, Math.ceil(tokens.length / 2));
  if (!halves) return subtitles;

  return reindex([
    ...subtitles.slice(0, idx),
    ...halves,
    ...subtitles.slice(idx + 1),
  ]);
}

/**
 * Cut a segment in two after `splitTokenIdx` whitespace-separated words.
 * Returns null when the segment cannot be split (empty / single word / bad index).
 */
function splitSegmentText(
  seg: Subtitle,
  splitTokenIdx: number
): [Subtitle, Subtitle] | null {
  const tokens = seg.text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  if (splitTokenIdx <= 0 || splitTokenIdx >= tokens.length) return null;

  const firstText = tokens.slice(0, splitTokenIdx).join(" ");
  const secondText = tokens.slice(splitTokenIdx).join(" ");

  const aligned = seg.words.length === tokens.length;
  let firstWords: Word[] = [];
  let secondWords: Word[] = [];
  let splitTime: number;
  let firstEnd: number;

  if (aligned) {
    // Word timestamps map 1:1 onto the text — precise cut, and refresh word
    // texts from the (possibly edited) segment text so they stay in sync.
    firstWords = seg.words
      .slice(0, splitTokenIdx)
      .map((w, i) => ({ ...w, text: tokens[i] }));
    secondWords = seg.words
      .slice(splitTokenIdx)
      .map((w, i) => ({ ...w, text: tokens[splitTokenIdx + i] }));
    splitTime = secondWords[0].startTime;
    // End the first half when its last word ends — the gap (if any) is a real
    // pause in speech, so the subtitle shouldn't linger over it.
    firstEnd = Math.min(firstWords[firstWords.length - 1].endTime, splitTime);
  } else if (seg.words.length >= 2) {
    // Text was edited and no longer matches words[] — keep the timings by
    // distributing words proportionally instead of dropping them.
    const wSplit = Math.min(
      seg.words.length - 1,
      Math.max(1, Math.round((splitTokenIdx / tokens.length) * seg.words.length))
    );
    firstWords = seg.words.slice(0, wSplit);
    secondWords = seg.words.slice(wSplit);
    splitTime = secondWords[0].startTime;
    firstEnd = Math.min(firstWords[firstWords.length - 1].endTime, splitTime);
  } else {
    // No word timestamps at all — interpolate proportionally by characters.
    const ratio = (firstText.length + 1) / (seg.text.trim().length + 1);
    splitTime = seg.startTime + Math.round((seg.endTime - seg.startTime) * ratio);
    firstEnd = splitTime;
  }

  splitTime = clampMs(splitTime, seg.startTime, seg.endTime);
  firstEnd = clampMs(firstEnd, seg.startTime, splitTime);

  return [
    {
      id: generateId(),
      index: 0,
      startTime: seg.startTime,
      endTime: firstEnd,
      text: firstText,
      words: firstWords,
      speaker: seg.speaker,
    },
    {
      id: generateId(),
      index: 0,
      startTime: splitTime,
      endTime: seg.endTime,
      text: secondText,
      words: secondWords,
      speaker: seg.speaker,
    },
  ];
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
    speaker: first.speaker ?? second.speaker,
  };

  const minIdx = Math.min(idx, targetIdx);
  return reindex([
    ...subtitles.slice(0, minIdx),
    merged,
    ...subtitles.slice(minIdx + 2),
  ]);
}

// ── Length-based re-segmentation ─────────────────────────────────────────────

export type SegmentLimitMode = "words" | "chars";

export interface SegmentLimit {
  mode: SegmentLimitMode;
  value: number;
}

/**
 * Re-split segments so that each one stays (approximately) within the given
 * limit of words or characters. Segments already within the limit are left
 * untouched; longer ones are cut into balanced pieces at word boundaries,
 * preferring natural break points (punctuation, pauses in speech).
 *
 * Word timestamps are never shifted: each piece starts exactly at its first
 * word's startTime and ends at its last word's endTime, so subtitles stay in
 * sync with the audio. Only splits — never merges across Whisper's sentence
 * boundaries.
 *
 * Returns the input array unchanged (same reference) when nothing exceeded the
 * limit, so callers can cheaply detect a no-op.
 */
export function resegmentByLength(
  subtitles: Subtitle[],
  limit: SegmentLimit
): Subtitle[] {
  if (!Number.isFinite(limit.value) || limit.value < 1) return subtitles;

  const out: Subtitle[] = [];
  let changed = false;
  for (const seg of subtitles) {
    const pieces = splitSegmentByLimit(seg, limit);
    if (pieces.length > 1) changed = true;
    out.push(...pieces);
  }
  if (!changed) return subtitles;
  return reindex(out);
}

function splitSegmentByLimit(seg: Subtitle, limit: SegmentLimit): Subtitle[] {
  const tokens = seg.text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return [seg];

  // Weight per token: 1 in words mode, chars + following space in chars mode
  const weights = tokens.map((t) => (limit.mode === "words" ? 1 : t.length + 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const limitWeight = limit.mode === "words" ? limit.value : limit.value + 1;
  if (total <= limitWeight) return [seg];

  // Words are usable for timing only when they map 1:1 onto the text tokens
  // (the text may have been edited after transcription).
  const aligned = seg.words.length === tokens.length;

  // Pick cut points with dynamic programming instead of a balanced-greedy pass:
  // the limit is a HARD cap (a group may exceed it only when a single token is
  // by itself heavier than the limit), and within that we minimise a cost that
  // (a) dislikes underfull groups, (b) likes cutting after punctuation or an
  // audible pause, and (c) refuses to strand connectives — short function
  // words like "i"/"na"/"że" shouldn't end a line, let alone stand alone.
  const PAUSE_MS = 250;
  const n = tokens.length;
  // Sentence-final punctuation is a great cut; a comma is only a mild one —
  // never worth stranding two half-empty pieces around it.
  const endsWithStrongPunct = (i: number) => /[.!?…]$/.test(tokens[i]);
  const endsWithPunct = (i: number) => /[.,!?…;:]$/.test(tokens[i]);
  // Heuristic: a short bare word ("i", "na", "że", "jak", "and", "the") is a
  // connective that belongs with what FOLLOWS it, not with what precedes.
  const isConnective = (i: number) => tokens[i].length <= 3 && !endsWithPunct(i);
  const pauseAfter = (i: number) =>
    aligned &&
    i + 1 < n &&
    seg.words[i + 1].startTime - seg.words[i].endTime >= PAUSE_MS;

  // dp[i] = minimal cost of segmenting tokens[0..i); prevCut[i] = where the
  // last group before i starts on that optimal path.
  const dp = new Array<number>(n + 1).fill(Infinity);
  const prevCut = new Array<number>(n + 1).fill(-1);
  dp[0] = 0;
  for (let i = 1; i <= n; i++) {
    let w = 0;
    for (let j = i - 1; j >= 0; j--) {
      w += weights[j];
      const size = i - j;
      if (w > limitWeight && size > 1) break; // hard cap (single token exempt)
      if (dp[j] === Infinity) continue;

      let cost = dp[j];
      // Underfull groups waste screen time — quadratic penalty on the gap.
      const fill = Math.min(w, limitWeight) / limitWeight;
      cost += (1 - fill) * (1 - fill) * 4;
      // Break quality at this cut (the final boundary is not a real cut)
      if (i < n) {
        if (endsWithStrongPunct(i - 1)) cost -= 2;
        else if (endsWithPunct(i - 1)) cost -= 0.75;
        else if (pauseAfter(i - 1)) cost -= 1.5;
        if (isConnective(i - 1)) cost += 2;
      }
      // A lone connective as its own subtitle reads terribly — avoid hard.
      if (size === 1 && isConnective(j)) cost += 4;

      if (cost < dp[i]) {
        dp[i] = cost;
        prevCut[i] = j;
      }
    }
  }

  // Backtrack the optimal cut positions
  const snapped: number[] = [];
  for (let i = prevCut[n]; i > 0; i = prevCut[i]) {
    snapped.unshift(i);
  }
  if (snapped.length === 0) return [seg];

  // Cut into pieces along the snapped boundaries
  const pieces: Subtitle[] = [];
  const starts = [0, ...snapped];
  const ends = [...snapped, tokens.length];
  let cumWeight = 0;

  for (let g = 0; g < starts.length; g++) {
    const s = starts[g];
    const e = ends[g];
    const pieceTokens = tokens.slice(s, e);
    const pieceWeight = weights.slice(s, e).reduce((a, b) => a + b, 0);

    let startTime: number;
    let endTime: number;
    let words: Word[];

    if (aligned) {
      // Word timestamps drive the timing — refresh word texts from the
      // (possibly edited) segment text so they stay in sync.
      words = seg.words.slice(s, e).map((w, i) => ({ ...w, text: pieceTokens[i] }));
      startTime = s === 0 ? seg.startTime : words[0].startTime;
      endTime = e === tokens.length ? seg.endTime : words[words.length - 1].endTime;
    } else {
      // Proportional timing by weight share
      const duration = seg.endTime - seg.startTime;
      startTime =
        s === 0
          ? seg.startTime
          : seg.startTime + Math.round((duration * cumWeight) / total);
      endTime =
        e === tokens.length
          ? seg.endTime
          : seg.startTime + Math.round((duration * (cumWeight + pieceWeight)) / total);
      // Keep any existing (mismatched) word timings with the piece they fall into
      words = seg.words.filter((w) => {
        const midMs = (w.startTime + w.endTime) / 2;
        return midMs >= startTime && (e === tokens.length || midMs < endTime);
      });
    }

    pieces.push({
      id: generateId(),
      index: 0,
      startTime: clampMs(startTime, seg.startTime, seg.endTime),
      endTime: clampMs(Math.max(endTime, startTime), seg.startTime, seg.endTime),
      text: pieceTokens.join(" "),
      words,
      speaker: seg.speaker,
    });
    cumWeight += pieceWeight;
  }

  return pieces;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clampMs(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function wordsToText(words: Word[]): string {
  return words
    .map((w) => w.text)
    .join(" ")
    .trim();
}
