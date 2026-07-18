import { describe, it, expect } from "vitest";
import { diffSubtitles } from "./diff";
import type { Subtitle } from "../types/subtitle";

function sub(index: number, text: string): Subtitle {
  return { id: `s${index}`, index, startTime: index * 1000, endTime: index * 1000 + 900, text, words: [] };
}

// version = old snapshot, current = now. diffSubtitles(current, version)
const version = [sub(1, "one"), sub(2, "two"), sub(3, "three"), sub(4, "four")];

describe("diffSubtitles (content-aligned)", () => {
  it("reports no changes for identical lists", () => {
    const diffs = diffSubtitles(version, version);
    expect(diffs.every((d) => d.status === "equal")).toBe(true);
  });

  it("a single deletion shows exactly one removed row, the rest equal", () => {
    // current has segment 2 deleted (and reindexed)
    const current = [sub(1, "one"), sub(2, "three"), sub(3, "four")];
    const diffs = diffSubtitles(current, version);
    const removed = diffs.filter((d) => d.status === "removed");
    const changed = diffs.filter((d) => d.status === "changed");
    const added = diffs.filter((d) => d.status === "added");
    expect(removed.map((d) => d.leftText)).toEqual(["two"]);
    expect(changed).toHaveLength(0);
    expect(added).toHaveLength(0);
  });

  it("a single edit shows exactly one changed row", () => {
    const current = [sub(1, "one"), sub(2, "two edited"), sub(3, "three"), sub(4, "four")];
    const diffs = diffSubtitles(current, version);
    expect(diffs.filter((d) => d.status === "changed")).toHaveLength(1);
    expect(diffs.filter((d) => d.status === "removed")).toHaveLength(0);
    expect(diffs.filter((d) => d.status === "added")).toHaveLength(0);
  });

  it("a single insertion shows exactly one added row", () => {
    const current = [sub(1, "one"), sub(2, "one-and-a-half"), sub(3, "two"), sub(4, "three"), sub(5, "four")];
    const diffs = diffSubtitles(current, version);
    expect(diffs.filter((d) => d.status === "added").map((d) => d.rightText)).toEqual(["one-and-a-half"]);
    expect(diffs.filter((d) => d.status === "changed")).toHaveLength(0);
  });
});
