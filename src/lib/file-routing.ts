/**
 * Single source of truth for "user picked / dropped a file — what now?".
 * Both the Toolbar's open dialogs and the global drag-drop listener call into
 * the same handlers so behaviour stays in sync.
 */
import i18n from "../i18n";
import {
  importSrt as importSrtCmd,
  extractAudio,
} from "./tauri-commands";
import { formatError, isCancellation } from "./error-format";
import type { Subtitle } from "../types/subtitle";

export const MEDIA_EXTENSIONS = [
  "mp4", "mkv", "avi", "mov", "webm", "m4v",
  "mp3", "wav", "flac", "ogg", "m4a", "aac",
] as const;

// The backend audio-extraction state is a single slot (one ffmpeg child, one cancel flag),
// so two overlapping extractions would corrupt each other. This module-level guard makes
// media opens serial across every entry point (drag-drop, toolbar, recent files).
let mediaExtractionInFlight = false;

export const SRT_EXTENSIONS = ["srt"] as const;

export type FileKind = "media" | "srt" | "unsupported";

export function classifyFile(path: string): FileKind {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return "unsupported";
  if ((MEDIA_EXTENSIONS as readonly string[]).includes(ext)) return "media";
  if ((SRT_EXTENSIONS as readonly string[]).includes(ext)) return "srt";
  return "unsupported";
}

export interface FileRoutingCallbacks {
  setFilePath: (path: string) => void;
  setProjectKey: (path: string) => Promise<void>;
  setSubtitles: (subs: Subtitle[]) => void;
  /** Clear the translation snapshot/comparison UI left over from the previous file. */
  clearTranslationState: () => void;
  addVersion: (subs: Subtitle[], source: "import", meta: { srtPath: string }) => void;
  autoSaveOnImport: boolean;
  onStartAudioExtraction?: () => void;
  onStartTranscription: (audioPath: string) => void;
  onError: (message: string) => void;
  onRecordFile?: (path: string, kind: "media" | "srt") => void;
}

/**
 * Routes a single file path to the right pipeline based on its extension.
 * Returns true if the file was recognised (media or SRT), false otherwise.
 */
export async function routeFile(
  path: string,
  cb: FileRoutingCallbacks,
): Promise<boolean> {
  const kind = classifyFile(path);

  if (kind === "media") {
    // Ignore overlapping media opens while an extraction is already running.
    if (mediaExtractionInFlight) return true;
    mediaExtractionInFlight = true;
    // A new project starts — the previous file's translation snapshot is stale.
    cb.clearTranslationState();
    cb.setFilePath(path);
    // Deriving/loading the version-history key must never block or abort the
    // transcription pipeline — treat any failure here as "history unavailable".
    try {
      await cb.setProjectKey(path);
    } catch {
      /* non-fatal */
    }
    cb.onRecordFile?.(path, "media");
    cb.onStartAudioExtraction?.();
    try {
      const audioPath = await extractAudio(path);
      cb.onStartTranscription(audioPath);
    } catch (e) {
      // A user-cancelled extraction isn't an error — the UI already reset its state.
      if (!isCancellation(e)) {
        cb.onError(formatError(i18n.t, e));
      }
    } finally {
      mediaExtractionInFlight = false;
    }
    return true;
  }

  if (kind === "srt") {
    try {
      const subs = await importSrtCmd(path);
      cb.clearTranslationState();
      cb.setSubtitles(subs);
      await cb.setProjectKey(path);
      cb.onRecordFile?.(path, "srt");
      if (cb.autoSaveOnImport) {
        cb.addVersion(subs, "import", { srtPath: path });
      }
    } catch (e) {
      cb.onError(formatError(i18n.t, e));
    }
    return true;
  }

  return false;
}
