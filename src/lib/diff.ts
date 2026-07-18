export type DiffTag = "equal" | "insert" | "delete";

export interface DiffToken {
  text: string;
  tag: DiffTag;
}

export interface SubtitleDiff {
  index: number;
  startTime: number;
  endTime: number;
  status: "equal" | "changed" | "added" | "removed";
  // left = current, right = version
  leftText: string;
  rightText: string;
  tokens: DiffToken[];
}

function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

function buildDiff(a: string[], b: string[]): DiffToken[] {
  const dp = lcsTable(a, b);
  const result: DiffToken[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ text: a[i - 1], tag: "equal" });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ text: b[j - 1], tag: "insert" });
      j--;
    } else {
      result.push({ text: a[i - 1], tag: "delete" });
      i--;
    }
  }

  return result.reverse();
}

export function wordDiff(currentText: string, versionText: string): DiffToken[] {
  if (currentText === versionText) {
    return [{ text: currentText, tag: "equal" }];
  }
  const wordsA = currentText.split(/(\s+)/);
  const wordsB = versionText.split(/(\s+)/);
  return buildDiff(wordsA, wordsB);
}

import { Subtitle } from "../types/subtitle";

/**
 * Diff between the current subtitles and a past `version`, aligned by content
 * (LCS over the segment texts) rather than by row index. Aligning by index made
 * a single deletion/insertion shift every following row, so the whole list
 * showed as "changed"; LCS keeps the untouched segments matched so only the
 * real edits stand out.
 *
 * Semantics are version → current (what changed to reach the current state):
 *   added   — a line present now but not in the version (green)
 *   removed — a line that was in the version but is gone now (red)
 *   changed — a line kept but edited (word-level diff, old → new)
 *   equal   — unchanged
 */
export function diffSubtitles(
  current: Subtitle[],
  version: Subtitle[]
): SubtitleDiff[] {
  const a = current;
  const b = version;
  const m = a.length;
  const n = b.length;

  // LCS over the segment texts.
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1].text === b[j - 1].text
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack into a flat op list (keep / current-only / version-only).
  type Op =
    | { kind: "equal"; cur: Subtitle }
    | { kind: "curOnly"; cur: Subtitle }
    | { kind: "verOnly"; ver: Subtitle };
  const ops: Op[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1].text === b[j - 1].text) {
      ops.push({ kind: "equal", cur: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ kind: "verOnly", ver: b[j - 1] });
      j--;
    } else {
      ops.push({ kind: "curOnly", cur: a[i - 1] });
      i--;
    }
  }
  ops.reverse();

  const added = (cur: Subtitle): SubtitleDiff => ({
    index: cur.index,
    startTime: cur.startTime,
    endTime: cur.endTime,
    status: "added",
    leftText: "",
    rightText: cur.text,
    tokens: [{ text: cur.text, tag: "insert" }],
  });
  const removed = (ver: Subtitle): SubtitleDiff => ({
    index: ver.index,
    startTime: ver.startTime,
    endTime: ver.endTime,
    status: "removed",
    leftText: ver.text,
    rightText: "",
    tokens: [{ text: ver.text, tag: "delete" }],
  });
  const changed = (ver: Subtitle, cur: Subtitle): SubtitleDiff => ({
    index: cur.index,
    startTime: cur.startTime,
    endTime: cur.endTime,
    status: "changed",
    leftText: ver.text,
    rightText: cur.text,
    tokens: wordDiff(ver.text, cur.text),
  });

  const result: SubtitleDiff[] = [];
  let k = 0;
  while (k < ops.length) {
    const op = ops[k];
    if (op.kind === "equal") {
      result.push({
        index: op.cur.index,
        startTime: op.cur.startTime,
        endTime: op.cur.endTime,
        status: "equal",
        leftText: op.cur.text,
        rightText: op.cur.text,
        tokens: [{ text: op.cur.text, tag: "equal" }],
      });
      k++;
      continue;
    }
    // Collect a contiguous run of non-equal ops and pair curOnly ⇄ verOnly
    // within it so an in-place edit reads as one "changed" row rather than a
    // separate add + remove.
    const curs: Subtitle[] = [];
    const vers: Subtitle[] = [];
    while (k < ops.length && ops[k].kind !== "equal") {
      const o = ops[k];
      if (o.kind === "curOnly") curs.push(o.cur);
      else if (o.kind === "verOnly") vers.push(o.ver);
      k++;
    }
    const pairs = Math.min(curs.length, vers.length);
    for (let p = 0; p < pairs; p++) result.push(changed(vers[p], curs[p]));
    for (let p = pairs; p < curs.length; p++) result.push(added(curs[p]));
    for (let p = pairs; p < vers.length; p++) result.push(removed(vers[p]));
  }

  return result;
}
