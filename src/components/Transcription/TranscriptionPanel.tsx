import { useState, useEffect } from "react";
import { Mic, Download, Loader2, CheckCircle2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useVersionStore } from "../../stores/versionStore";
import {
  listModels,
  downloadModel,
  transcribeAudio,
  cancelTranscription,
} from "../../lib/tauri-commands";
import { formatError, isCancellation } from "../../lib/error-format";
import type { WhisperModelInfo, TranscriptionProgress } from "../../types/subtitle";

const LANGUAGE_OPTIONS = [
  "auto",
  "en",
  "pl",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "ja",
  "ko",
  "zh",
  "ru",
  "uk",
] as const;

interface TranscriptionPanelProps {
  audioPath: string | null;
}

export default function TranscriptionPanel({ audioPath }: TranscriptionPanelProps) {
  const { t } = useTranslation(["transcription", "common"]);
  const { whisperModel, setWhisperModel, autoSaveOnTranscription } = useSettingsStore();
  const { setSubtitles } = useSubtitleStore();
  const { addVersion } = useVersionStore();

  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState("auto");
  const [detectSpeakers, setDetectSpeakers] = useState(false);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      const m = await listModels();
      setModels(m);
    } catch (e) {
      console.error("Failed to list models:", e);
    }
  };

  const selectedModel = models.find((m) => m.name === whisperModel);

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadProgress(0);
    setError(null);
    try {
      await downloadModel(whisperModel, (p) => setDownloadProgress(p));
      await loadModels();
    } catch (e) {
      setError(formatError(t, e));
    } finally {
      setDownloading(false);
    }
  };

  const handleTranscribe = async () => {
    if (!audioPath) return;
    setTranscribing(true);
    setProgress(null);
    setError(null);
    try {
      const subs = await transcribeAudio(
        audioPath,
        whisperModel,
        language === "auto" ? null : language,
        detectSpeakers,
        (p) => setProgress(p)
      );
      setSubtitles(subs);
      if (autoSaveOnTranscription) {
        addVersion(subs, "transcription", {
          whisperModel,
          language: language === "auto" ? undefined : language,
        });
      }
    } catch (e) {
      if (isCancellation(e)) {
        setProgress({
          stage: "cancelled",
          progress: 0,
          message: t("errors:CANCELLED", { ns: "errors" }),
        });
      } else {
        setError(formatError(t, e));
      }
    } finally {
      setTranscribing(false);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelTranscription();
    } catch (e) {
      console.error("Cancel failed:", e);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <Mic size={16} />
        {t("transcription:header")}
      </h3>

      {/* Model selector */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
          {t("transcription:modelLabel")}
        </label>
        <select
          value={whisperModel}
          onChange={(e) => setWhisperModel(e.target.value)}
          className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
          disabled={transcribing}
        >
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name} ({m.sizeMb} MB)
              {m.downloaded ? " \u2713" : ""}
            </option>
          ))}
        </select>

        {selectedModel && !selectedModel.downloaded && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-1.5 w-full justify-center rounded bg-gray-100 dark:bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
          >
            {downloading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {t("transcription:downloading", {
                  percent: Math.round(downloadProgress * 100),
                })}
              </>
            ) : (
              <>
                <Download size={14} />
                {t("transcription:downloadModel", { sizeMb: selectedModel.sizeMb })}
              </>
            )}
          </button>
        )}
      </div>

      {/* Language */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
          {t("transcription:languageLabel")}
        </label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
          disabled={transcribing}
        >
          {LANGUAGE_OPTIONS.map((code) => (
            <option key={code} value={code}>
              {t(`transcription:language.${code}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Speaker detection toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={detectSpeakers}
          onChange={(e) => setDetectSpeakers(e.target.checked)}
          disabled={transcribing}
          className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-500 focus:ring-blue-400"
        />
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
          {t("transcription:detectSpeakers")}
        </span>
      </label>

      {/* Transcribe / Cancel button */}
      {transcribing ? (
        <button
          onClick={handleCancel}
          className="flex items-center gap-2 w-full justify-center rounded-lg bg-red-500 hover:bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          <X size={16} />
          {t("transcription:cancel")}
        </button>
      ) : (
        <button
          onClick={handleTranscribe}
          disabled={!audioPath || (selectedModel && !selectedModel.downloaded)}
          className="flex items-center gap-2 w-full justify-center rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 dark:disabled:bg-blue-800 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          <Mic size={16} />
          {t("transcription:transcribe")}
        </button>
      )}

      {/* Progress */}
      {progress && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            {progress.stage === "done" ? (
              <CheckCircle2 size={14} className="text-green-500" />
            ) : (
              <Loader2 size={14} className="animate-spin" />
            )}
            {progress.message}
          </div>
          <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-[width] duration-300"
              style={{ width: `${progress.progress * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Status */}
      {!audioPath && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
          {t("transcription:emptyState")}
        </p>
      )}

      {/* Error */}
      {error && (
        <div className="rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
