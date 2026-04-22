import { create } from "zustand";
import { Subtitle } from "../types/subtitle";
import {
  SubtitleVersion,
  SubtitleVersionMetadata,
  VersionAction,
} from "../types/version";
import { loadVersionHistory, saveVersionHistory } from "../lib/tauri-commands";

const MAX_VERSIONS = 50;

function deriveProjectKey(filePath: string): string {
  return btoa(filePath)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
    .slice(0, 64);
}

function makeLabel(action: VersionAction, metadata: SubtitleVersionMetadata): string {
  switch (action) {
    case "transcription":
      return `Transkrypcja (${metadata.whisperModel ?? ""}, ${metadata.language ?? "auto"})`;
    case "translation":
      return `Tłumaczenie → ${metadata.targetLang} (${metadata.provider})`;
    case "import":
      return `Import SRT: ${metadata.srtPath?.split("/").pop() ?? ""}`;
    case "manual":
      return "Zapisana ręcznie";
  }
}

interface VersionState {
  projectKey: string | null;
  versions: SubtitleVersion[];

  setProjectKey: (filePath: string | null) => Promise<void>;
  addVersion: (
    subtitles: Subtitle[],
    action: VersionAction,
    metadata: SubtitleVersionMetadata
  ) => void;
  restoreVersion: (
    id: string,
    setSubtitles: (s: Subtitle[]) => void
  ) => void;
}

export const useVersionStore = create<VersionState>()((set, get) => ({
  projectKey: null,
  versions: [],

  setProjectKey: async (filePath) => {
    if (!filePath) {
      set({ projectKey: null, versions: [] });
      return;
    }
    const key = deriveProjectKey(filePath);
    set({ projectKey: key, versions: [] });
    const loaded = await loadVersionHistory(key).catch(() => null);
    if (loaded) {
      set({ versions: loaded });
    }
  },

  addVersion: (subtitles, action, metadata) => {
    const { projectKey, versions } = get();
    const newVersion: SubtitleVersion = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      label: makeLabel(action, metadata),
      action,
      metadata,
      subtitles,
    };
    const capped = [newVersion, ...versions].slice(0, MAX_VERSIONS);
    set({ versions: capped });
    if (projectKey) {
      saveVersionHistory(projectKey, capped).catch(console.error);
    }
  },

  restoreVersion: (id, setSubtitles) => {
    const version = get().versions.find((v) => v.id === id);
    if (version) {
      setSubtitles(version.subtitles);
    }
  },
}));
