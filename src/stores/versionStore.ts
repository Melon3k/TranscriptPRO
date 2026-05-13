import { create } from "zustand";
import i18n from "../i18n";
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
      return i18n.t("history:label.transcription", {
        ns: "history",
        whisperModel: metadata.whisperModel ?? "",
        language: metadata.language ?? "auto",
      });
    case "translation":
      return i18n.t("history:label.translation", {
        ns: "history",
        targetLang: metadata.targetLang ?? "",
        provider: metadata.provider ?? "",
      });
    case "import":
      return i18n.t("history:label.import", {
        ns: "history",
        filename: metadata.srtPath?.split("/").pop() ?? "",
      });
    case "manual":
      return i18n.t("history:label.manual", { ns: "history" });
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
