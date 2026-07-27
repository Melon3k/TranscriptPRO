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

/**
 * FNV-1a over UTF-8 bytes — deterministic and Unicode-safe. Only used as a fallback
 * when SubtleCrypto is unavailable (should not happen in a secure-context webview).
 */
function fnv1aHex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Stable, collision-resistant project key from a file path.
 * SHA-256 hex is Unicode-safe (unlike the old `btoa`, which threw on non-Latin-1
 * paths — e.g. Polish characters) and never truncated, so distinct long paths no
 * longer collide. The all-hex output is also inherently path-traversal-safe.
 */
async function deriveProjectKey(filePath: string): Promise<string> {
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(filePath)
    );
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return fnv1aHex(filePath);
  }
}

/**
 * The pre-hash key format. Kept only to migrate history files saved before the switch.
 * Returns null for paths `btoa` can't encode (non-Latin-1) — those never had a file.
 */
function legacyProjectKey(filePath: string): string | null {
  try {
    return btoa(filePath)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "")
      .slice(0, 64);
  } catch {
    return null;
  }
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
  /** Records a version and (if there's a project key) persists the whole
   *  history. Resolves true only when the write to disk succeeded, so callers
   *  gating `dirty` on autosave can keep it set on failure / no-project-key. */
  addVersion: (
    subtitles: Subtitle[],
    action: VersionAction,
    metadata: SubtitleVersionMetadata
  ) => Promise<boolean>;
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
    const key = await deriveProjectKey(filePath);
    set({ projectKey: key, versions: [] });

    let loaded = await loadVersionHistory(key).catch(() => null);

    // One-time migration: if nothing is stored under the new hash key, try the old
    // `btoa` key and, if found, re-save it under the new key so it's stable going forward.
    if (!loaded) {
      const legacy = legacyProjectKey(filePath);
      if (legacy && legacy !== key) {
        const legacyLoaded = await loadVersionHistory(legacy).catch(() => null);
        if (legacyLoaded) {
          loaded = legacyLoaded;
          saveVersionHistory(key, legacyLoaded).catch(console.error);
        }
      }
    }

    // Only apply if the user hasn't switched to another project in the meantime.
    if (loaded && get().projectKey === key) {
      set({ versions: loaded });
    }
  },

  addVersion: async (subtitles, action, metadata) => {
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
    // No project key → nowhere to persist (e.g. audio-only or key derivation
    // failed). Don't pretend it saved; the caller must keep `dirty` set.
    if (!projectKey) return false;
    try {
      await saveVersionHistory(projectKey, capped);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },

  restoreVersion: (id, setSubtitles) => {
    const version = get().versions.find((v) => v.id === id);
    if (version) {
      setSubtitles(version.subtitles);
    }
  },
}));
