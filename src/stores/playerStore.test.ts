import { describe, it, expect, beforeEach } from "vitest";
import { usePlayerStore } from "./playerStore";

beforeEach(() => {
  usePlayerStore.setState({
    filePath: null,
    previewPath: null,
    previewLoading: false,
    previewPct: 0,
    currentTimeMs: 0,
    duration: 0,
    isPlaying: false,
  });
});

describe("playerStore.setFilePath", () => {
  it("resets the preview proxy state so a new file re-prepares from scratch", () => {
    // Simulate a prepared proxy from a previous file.
    usePlayerStore.setState({
      filePath: "/old.mp4",
      previewPath: "/tmp/old-proxy.mp4",
      previewLoading: true,
      previewPct: 80,
      currentTimeMs: 12000,
    });

    usePlayerStore.getState().setFilePath("/new-4k.mov");

    const s = usePlayerStore.getState();
    expect(s.filePath).toBe("/new-4k.mov"); // filePath stays the ORIGINAL
    expect(s.previewPath).toBeNull();
    expect(s.previewLoading).toBe(false);
    expect(s.previewPct).toBe(0);
    expect(s.currentTimeMs).toBe(0);
  });
});
