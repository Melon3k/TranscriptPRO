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
import { formatError } from "./error-format";
import type { Subtitle } from "../types/subtitle";

export const MEDIA_EXTENSIONS = [
  "mp4", "mkv", "avi", "mov", "webm", "m4v",
  "mp3", "wav", "flac", "ogg", "m4a", "aac",
] as const;

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
  addVersion: (subs: Subtitle[], source: "import", meta: { srtPath: string }) => void;
  autoSaveOnImport: boolean;
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
    cb.setFilePath(path);
    await cb.setProjectKey(path);
    cb.onRecordFile?.(path, "media");
    try {
      const audioPath = await extractAudio(path);
      cb.onStartTranscription(audioPath);
    } catch (e) {
      cb.onError(formatError(i18n.t, e));
    }
    return true;
  }

  if (kind === "srt") {
    try {
      const subs = await importSrtCmd(path);
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
