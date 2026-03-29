import { invoke, Channel } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  Subtitle,
  TranscriptionProgress,
  WhisperModelInfo,
} from "../types/subtitle";

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

// ── Audio extraction ─────────────────────────────────────────────────────────

export async function extractAudio(inputPath: string): Promise<string> {
  return invoke<string>("extract_audio", { inputPath });
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

// ── Transcription ────────────────────────────────────────────────────────────

export async function transcribeAudio(
  audioPath: string,
  modelName: string,
  language: string | null,
  detectSpeakers: boolean,
  onProgress: (progress: TranscriptionProgress) => void
): Promise<Subtitle[]> {
  const channel = new Channel<TranscriptionProgress>();
  channel.onmessage = onProgress;
  return invoke<Subtitle[]>("transcribe_audio", {
    audioPath,
    modelName,
    language,
    detectSpeakers,
    onProgress: channel,
  });
}

// ── Translation ──────────────────────────────────────────────────────────────

export async function translateSubtitles(
  subtitles: Subtitle[],
  targetLang: string,
  provider: "deepl" | "google",
  apiKey: string,
  sourceLang?: string
): Promise<Subtitle[]> {
  return invoke<Subtitle[]>("translate_subtitles", {
    subtitles,
    targetLang,
    provider,
    apiKey,
    sourceLang: sourceLang ?? null,
  });
}
