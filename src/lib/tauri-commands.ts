import { invoke, Channel } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Subtitle,
  TranscriptionProgress,
  TranslationProgress,
  WhisperModelInfo,
} from "../types/subtitle";
import { SubtitleVersion } from "../types/version";
import type { CaptionStyle, CaptionAnimation } from "../types/captionStyle";

// ── File dialogs ─────────────────────────────────────────────────────────────

export async function openMediaFileDialog(): Promise<string | null> {
  const result = await open({
    filters: [
      {
        name: "Media",
        extensions: [
          "mp4", "mkv", "avi", "mov", "webm", "m4v",
          "mp3", "wav", "flac", "ogg", "m4a", "aac",
        ],
      },
    ],
    multiple: false,
  });
  return result as string | null;
}

export async function openSrtFileDialog(): Promise<string | null> {
  const result = await open({
    filters: [{ name: "SRT Subtitles", extensions: ["srt"] }],
    multiple: false,
  });
  return result as string | null;
}

export async function saveSrtFileDialog(
  defaultName = "subtitles.srt"
): Promise<string | null> {
  return save({
    filters: [{ name: "SRT Subtitles", extensions: ["srt"] }],
    defaultPath: defaultName,
  });
}

export async function saveTxtFileDialog(
  defaultName = "subtitles.txt"
): Promise<string | null> {
  return save({
    filters: [{ name: "Text File", extensions: ["txt"] }],
    defaultPath: defaultName,
  });
}

export async function saveVttFileDialog(
  defaultName = "subtitles.vtt"
): Promise<string | null> {
  return save({
    filters: [{ name: "WebVTT Subtitles", extensions: ["vtt"] }],
    defaultPath: defaultName,
  });
}

export async function saveAssFileDialog(
  defaultName = "subtitles.ass"
): Promise<string | null> {
  return save({
    filters: [{ name: "ASS Subtitles", extensions: ["ass"] }],
    defaultPath: defaultName,
  });
}

export async function saveMp4FileDialog(
  defaultName = "video.mp4"
): Promise<string | null> {
  return save({
    filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
    defaultPath: defaultName,
  });
}

// ── File I/O commands ────────────────────────────────────────────────────────

export async function importSrt(path: string): Promise<Subtitle[]> {
  return invoke<Subtitle[]>("import_srt", { path });
}

export async function exportSrt(
  path: string,
  subtitles: Subtitle[]
): Promise<void> {
  return invoke("export_srt", { path, subtitles });
}

export async function exportWordSrt(
  path: string,
  subtitles: Subtitle[]
): Promise<void> {
  return invoke("export_word_srt", { path, subtitles });
}

export async function exportTxt(
  path: string,
  subtitles: Subtitle[]
): Promise<void> {
  return invoke("export_txt", { path, subtitles });
}

export async function exportVtt(
  path: string,
  subtitles: Subtitle[]
): Promise<void> {
  return invoke("export_vtt", { path, subtitles });
}

export async function exportAss(
  path: string,
  subtitles: Subtitle[],
  style: CaptionStyle,
  animation: CaptionAnimation
): Promise<void> {
  return invoke("export_ass", { path, subtitles, style, animation });
}

export type PreviewFormat = "srt" | "vtt";

export async function previewExport(
  subtitles: Subtitle[],
  format: PreviewFormat,
): Promise<string> {
  return invoke<string>("preview_export", { subtitles, format });
}

export async function saveVersionHistory(
  projectKey: string,
  versions: SubtitleVersion[]
): Promise<void> {
  return invoke("save_version_history", {
    projectKey,
    versionsJson: JSON.stringify(versions),
  });
}

export async function loadVersionHistory(
  projectKey: string
): Promise<SubtitleVersion[] | null> {
  const raw = await invoke<string | null>("load_version_history", { projectKey });
  return raw ? (JSON.parse(raw) as SubtitleVersion[]) : null;
}

// ── Audio extraction ─────────────────────────────────────────────────────────

export async function extractAudio(inputPath: string): Promise<string> {
  return invoke<string>("extract_audio", { inputPath });
}

// ── Video export (MP4 subtitle burn-in) ──────────────────────────────────────

/** How the burn-in resolved the caption font.
 *  `bundled` = app TTFs (matches the preview); `system` = an OS font resolved
 *  by fontconfig (faithful — the same installed font the preview used);
 *  `substituted` = bundled TTFs couldn't be copied, so libass substituted. */
export type FontOutcome = "bundled" | "system" | "substituted";

/**
 * Burn the currently-loaded video's styled + animated subtitles into an MP4.
 * Progress is reported 0..1 over a Channel, mirroring downloadModel.
 * Only STYLE + FADE + KARAOKE burn in; slide/pop/typewriter/blur render as
 * plain (un-animated) captions.
 *
 * Resolves to how the burn resolved the font: `bundled` (app TTFs, matches the
 * preview), `system` (OS font resolved by fontconfig, faithful — the same
 * installed font the preview used), or `substituted` (bundled TTFs unavailable,
 * libass substituted). The caller uses this to avoid claiming a match that
 * didn't happen.
 */
export async function exportVideo(
  videoPath: string,
  subtitles: Subtitle[],
  style: CaptionStyle,
  animation: CaptionAnimation,
  outputPath: string,
  onProgress: (progress: number) => void
): Promise<FontOutcome> {
  const channel = new Channel<number>();
  channel.onmessage = onProgress;
  return invoke<FontOutcome>("export_video", {
    videoPath,
    subtitles,
    style,
    animation,
    outputPath,
    onProgress: channel,
  });
}

export async function cancelVideoExport(): Promise<void> {
  return invoke("cancel_video_export");
}

// ── Preview proxy (lightweight playback transcode) ───────────────────────────

/** Result of probing/transcoding a media file for playback.
 *  `previewPath` is the lightweight proxy to play instead of the original
 *  (null when none is needed / on audio-only, in which case the caller plays
 *  the original). `needsProxy` reflects the probe decision; width/height are
 *  the source video dimensions. The ORIGINAL filePath is still used for
 *  transcription and burn-in — the proxy is display-only. */
export interface PreviewInfo {
  previewPath: string | null;
  needsProxy: boolean;
  width: number;
  height: number;
}

/**
 * Ask the backend to prepare a display proxy for a media file (WKWebView can't
 * render heavy 4K / rotated video). Progress is reported 0..100 over a Channel,
 * mirroring exportVideo's pattern.
 */
export async function preparePreview(
  inputPath: string,
  onProgress?: (pct: number) => void,
): Promise<PreviewInfo> {
  const channel = new Channel<{ pct: number }>();
  if (onProgress) channel.onmessage = (p) => onProgress(p.pct);
  return invoke<PreviewInfo>("prepare_preview", { inputPath, onProgress: channel });
}

export async function cancelPreview(): Promise<void> {
  return invoke("cancel_preview");
}

// ── Whisper model management ─────────────────────────────────────────────────

export async function listModels(): Promise<WhisperModelInfo[]> {
  return invoke<WhisperModelInfo[]>("list_models");
}

export async function downloadModel(
  modelName: string,
  onProgress: (progress: number) => void
): Promise<void> {
  const channel = new Channel<number>();
  channel.onmessage = onProgress;
  return invoke("download_model", { modelName, onProgress: channel });
}

// ── Local translation model (TranslateGemma) ─────────────────────────────────

export interface LocalModelInfo {
  downloaded: boolean;
  sizeMb: number;
}

export async function localModelStatus(): Promise<LocalModelInfo> {
  return invoke<LocalModelInfo>("local_model_status");
}

export async function downloadLocalModel(
  onProgress: (progress: number) => void
): Promise<void> {
  const channel = new Channel<number>();
  channel.onmessage = onProgress;
  return invoke("download_local_model", { onProgress: channel });
}

export async function cancelLocalModelDownload(): Promise<void> {
  return invoke("cancel_local_model_download");
}

// ── System fonts ─────────────────────────────────────────────────────────────

/** DISTINCT, sorted, human-readable font family names installed on the machine.
 *  Called lazily (font control open) and cached by the caller — can be a few
 *  hundred entries. REJECTS on failure (rather than resolving []) so the caller
 *  can tell a transient error apart from a genuinely empty list and retry
 *  instead of caching the failure forever. The bundled quick-picks are shown
 *  regardless, since they come from CAPTION_FONTS, not from this call. */
export async function listSystemFonts(): Promise<string[]> {
  return invoke<string[]>("list_system_fonts");
}

// ── Transcription ────────────────────────────────────────────────────────────

export async function transcribeAudio(
  audioPath: string,
  modelName: string,
  language: string,
  detectSpeakers: boolean,
  forceCpu: boolean,
  onProgress: (progress: TranscriptionProgress) => void
): Promise<Subtitle[]> {
  const channel = new Channel<TranscriptionProgress>();
  channel.onmessage = onProgress;
  return invoke<Subtitle[]>("transcribe_audio", {
    audioPath,
    modelName,
    language,
    detectSpeakers,
    forceCpu,
    onProgress: channel,
  });
}

export async function cancelTranscription(): Promise<void> {
  return invoke("cancel_transcription");
}

// ── Translation ──────────────────────────────────────────────────────────────

export interface TranslationResult {
  subtitles: Subtitle[];
  translatedCount: number;
  /** Set when the run stopped early on an error; subtitles hold the partial result. */
  warning: string | null;
}

export async function translateSubtitles(
  subtitles: Subtitle[],
  targetLang: string,
  provider: "gemini" | "claude" | "local",
  sourceLang?: string,
  model?: string,
  onProgress?: (progress: TranslationProgress) => void
): Promise<TranslationResult> {
  const channel = new Channel<TranslationProgress>();
  if (onProgress) channel.onmessage = onProgress;
  return invoke<TranslationResult>("translate_subtitles", {
    subtitles,
    targetLang,
    provider,
    sourceLang: sourceLang ?? null,
    model: model ?? null,
    onProgress: channel,
  });
}

export async function cancelTranslation(): Promise<void> {
  return invoke("cancel_translation");
}

// ── API keys (OS credential store) ────────────────────────────────────────────
// Keys live in the OS keychain / credential manager. The webview only ever
// learns whether a key is present — the key itself stays backend-side.

export type ApiKeyProvider = "gemini" | "claude";

export async function setApiKey(
  provider: ApiKeyProvider,
  key: string
): Promise<void> {
  return invoke("set_api_key", { provider, key });
}

export async function deleteApiKey(provider: ApiKeyProvider): Promise<void> {
  return invoke("delete_api_key", { provider });
}

export async function hasApiKey(provider: ApiKeyProvider): Promise<boolean> {
  return invoke<boolean>("has_api_key", { provider });
}

/** Unix seconds when the key was saved (null if none; 0 if saved pre-timestamp). */
export async function apiKeySavedAt(
  provider: ApiKeyProvider
): Promise<number | null> {
  return invoke<number | null>("api_key_saved_at", { provider });
}

// ── Audio extraction cancellation ─────────────────────────────────────────────

export async function cancelAudioExtraction(): Promise<void> {
  return invoke("cancel_audio_extraction");
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

/** Mirror the frontend unsaved-changes flag into native state (guards Cmd+Q / quit). */
export async function setDirty(dirty: boolean): Promise<void> {
  return invoke("set_dirty", { dirty });
}

/** Quit the app (after the user confirms discarding unsaved work). */
export async function exitApp(): Promise<void> {
  return invoke("exit_app");
}
