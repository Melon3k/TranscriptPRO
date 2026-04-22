import { Subtitle } from "./subtitle";

export type VersionAction = "transcription" | "translation" | "import" | "manual";

export interface SubtitleVersionMetadata {
  whisperModel?: string;
  language?: string;
  provider?: string;
  targetLang?: string;
  sourceLang?: string;
  srtPath?: string;
  model?: string;
}

export interface SubtitleVersion {
  id: string;
  timestamp: number;
  label: string;
  action: VersionAction;
  metadata: SubtitleVersionMetadata;
  subtitles: Subtitle[];
}
