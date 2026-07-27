import { describe, it, expect, vi, beforeEach } from "vitest";

// The store persists via these IPC wrappers — mock them so we can drive the
// success / failure / no-key paths that gate the caller's `dirty` flag.
vi.mock("../lib/tauri-commands", () => ({
  loadVersionHistory: vi.fn(async () => null),
  saveVersionHistory: vi.fn(async () => undefined),
}));

import { useVersionStore } from "./versionStore";
import { saveVersionHistory } from "../lib/tauri-commands";

const saveMock = vi.mocked(saveVersionHistory);

beforeEach(() => {
  saveMock.mockReset();
  saveMock.mockResolvedValue(undefined);
  useVersionStore.setState({ projectKey: null, versions: [] });
});

describe("versionStore.addVersion", () => {
  it("keeps the version in memory but returns false with no project key", async () => {
    const ok = await useVersionStore.getState().addVersion([], "manual", {});
    expect(ok).toBe(false); // caller must keep dirty = true
    expect(saveMock).not.toHaveBeenCalled();
    expect(useVersionStore.getState().versions).toHaveLength(1);
  });

  it("returns true only after a confirmed persist", async () => {
    useVersionStore.setState({ projectKey: "key", versions: [] });
    const ok = await useVersionStore.getState().addVersion([], "manual", {});
    expect(ok).toBe(true);
    expect(saveMock).toHaveBeenCalledOnce();
  });

  it("returns false when the persist throws (data stays in memory, dirty kept)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    useVersionStore.setState({ projectKey: "key", versions: [] });
    saveMock.mockRejectedValue(new Error("disk full"));
    const ok = await useVersionStore.getState().addVersion([], "manual", {});
    expect(ok).toBe(false);
    expect(useVersionStore.getState().versions).toHaveLength(1);
    errSpy.mockRestore();
  });
});
