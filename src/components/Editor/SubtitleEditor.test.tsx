// @vitest-environment jsdom
//
// Component regression tests for EDT-1 ("stale word-selection after a
// cross-segment move"). Word selection lives in SubtitleEditor's local state
// keyed by subtitle id, so the two fixes are only observable by rendering the
// real component and driving the store:
//   1. Pruning selectedWords to live ids on every subtitles change — a moved
//      segment gets a fresh id, orphaning its selection entry, which otherwise
//      keeps the "N words selected" banner (and the green drop-target chrome)
//      stuck on.
//   2. Clearing the selection on a plain row click (selectSeg).
//
// The visible proxy for "selection is active" is the selection banner, which
// renders iff totalSelected > 0.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18n from "../../i18n";
import SubtitleEditor from "./SubtitleEditor";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { usePlayerStore } from "../../stores/playerStore";
import type { Subtitle } from "../../types/subtitle";

const BANNER = /target block to move/i; // stable across plural forms (en)

function makeSub(id: string, index: number, start: number, words: string[]): Subtitle {
  const wordObjs = words.map((text, i) => ({
    text,
    startTime: start + i * 100,
    endTime: start + i * 100 + 90,
  }));
  return {
    id,
    index,
    startTime: start,
    endTime: start + words.length * 100,
    text: words.join(" "),
    words: wordObjs,
  };
}

// Two segments; currentTime 0 sits before both so neither is "active" and the
// scroll-into-view effect stays idle.
const SEG_A = () => makeSub("A", 1, 1000, ["alpha", "beta"]);
const SEG_B = () => makeSub("B", 2, 3000, ["gamma"]);

beforeAll(() => {
  // jsdom has no layout engine; the active-row effect calls scrollIntoView.
  Element.prototype.scrollIntoView = () => {};
  return i18n.changeLanguage("en");
});

beforeEach(() => {
  useSubtitleStore.setState({ subtitles: [SEG_A(), SEG_B()] });
  usePlayerStore.setState({ currentTimeMs: 0 });
});

afterEach(() => cleanup());

/** ⌘-click the given word chip inside a segment row to select it. */
function selectWord(subId: string, word: string) {
  const row = document.querySelector(`[data-word-row="${subId}"]`);
  expect(row, `row for segment ${subId}`).toBeTruthy();
  const chip = within(row as HTMLElement).getByText(word);
  fireEvent.click(chip, { metaKey: true });
}

describe("SubtitleEditor — EDT-1 word selection", () => {
  it("shows the selection banner after a word is ⌘-clicked", () => {
    render(<SubtitleEditor />);
    expect(screen.queryByText(BANNER)).toBeNull();

    selectWord("A", "alpha");

    expect(screen.getByText(BANNER)).toBeInTheDocument();
  });

  it("prunes an orphaned selection when its segment id disappears (the move bug)", async () => {
    render(<SubtitleEditor />);
    selectWord("A", "alpha");
    expect(screen.getByText(BANNER)).toBeInTheDocument();

    // Simulate what moveWords does to the SOURCE segment: it vanishes under its
    // old id (here we just drop segment A). The prune effect must clear the now
    // orphaned selection so the banner doesn't cling.
    useSubtitleStore.setState({ subtitles: [SEG_B()] });

    await waitFor(() => expect(screen.queryByText(BANNER)).toBeNull());
  });

  it("clears the selection on a plain row click (selectSeg)", async () => {
    render(<SubtitleEditor />);
    selectWord("A", "alpha");
    expect(screen.getByText(BANNER)).toBeInTheDocument();

    // A plain click on another segment's row must start clean.
    const rowB = document.querySelector('[data-word-row="B"]') as HTMLElement;
    fireEvent.click(rowB);

    await waitFor(() => expect(screen.queryByText(BANNER)).toBeNull());
  });
});
