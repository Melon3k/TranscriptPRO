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

export function diffSubtitles(
  current: Subtitle[],
  version: Subtitle[]
): SubtitleDiff[] {
  const maxLen = Math.max(current.length, version.length);
  const result: SubtitleDiff[] = [];

  for (let i = 0; i < maxLen; i++) {
    const cur = current[i];
    const ver = version[i];

    if (!ver) {
      // subtitle exists in current but not in version
      result.push({
        index: cur.index,
        startTime: cur.startTime,
        endTime: cur.endTime,
        status: "removed",
        leftText: cur.text,
        rightText: "",
        tokens: [{ text: cur.text, tag: "delete" }],
      });
    } else if (!cur) {
      // subtitle added in version
      result.push({
        index: ver.index,
        startTime: ver.startTime,
        endTime: ver.endTime,
        status: "added",
        leftText: "",
        rightText: ver.text,
        tokens: [{ text: ver.text, tag: "insert" }],
      });
    } else if (cur.text === ver.text) {
      result.push({
        index: cur.index,
        startTime: cur.startTime,
        endTime: cur.endTime,
        status: "equal",
        leftText: cur.text,
        rightText: ver.text,
        tokens: [{ text: cur.text, tag: "equal" }],
      });
    } else {
      result.push({
        index: cur.index,
        startTime: cur.startTime,
        endTime: cur.endTime,
        status: "changed",
        leftText: cur.text,
        rightText: ver.text,
        tokens: wordDiff(cur.text, ver.text),
      });
    }
  }

  return result;
}
