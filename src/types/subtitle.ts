export interface Word {
  text: string;
  startTime: number; // milliseconds
  endTime: number;   // milliseconds
}

export interface Subtitle {
  id: string;
  index: number;      // 1-based sequential
  startTime: number;  // milliseconds
  endTime: number;    // milliseconds
  text: string;
  words: Word[];      // word-level timestamps (empty after translation)
  speaker?: string;   // e.g. "Speaker 1" (from diarization)
}

export interface Project {
  filePath: string;
  subtitles: Subtitle[];
  language: string;
  whisperModel: string;
}

export type TranscriptionStage =
  | "loading_model"
  | "loading_audio"
  | "transcribing_audio"
  | "extracting_segments"
  | "segment_progress"
  | "detecting_speakers"
  | "done"
  | "cancelled";

export interface TranscriptionProgress {
  stage: TranscriptionStage;
  progress: number; // 0.0 to 1.0
  message: string;  // English fallback — UI prefers `stage` + interpolation
  index?: number;
  total?: number;
}

export interface WhisperModelInfo {
  name: string;
  sizeMb: number;
  downloaded: boolean;
  path: string | null;
  bundled: boolean;
}

export interface TranslationProgress {
  done: number;
  total: number;
}

export type TranslationProvider = "gemini" | "claude" | "local";

export interface TranslationConfig {
  provider: TranslationProvider;
  apiKey: string;
  targetLanguage: string;
  sourceLanguage?: string;
}
