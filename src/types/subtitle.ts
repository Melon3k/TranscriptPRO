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
}

export interface Project {
  filePath: string;
  subtitles: Subtitle[];
  language: string;
  whisperModel: string;
}

export interface TranscriptionProgress {
  stage: "extracting_audio" | "loading_model" | "transcribing" | "done";
  progress: number; // 0.0 to 1.0
  message: string;
}

export interface WhisperModelInfo {
  name: string;
  sizeMb: number;
  downloaded: boolean;
  path: string | null;
  bundled: boolean;
}

export type TranslationProvider = "deepl" | "google";

export interface TranslationConfig {
  provider: TranslationProvider;
  apiKey: string;
  targetLanguage: string;
  sourceLanguage?: string;
}
