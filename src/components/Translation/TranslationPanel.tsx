import { useEffect, useState } from "react";
import { Download, Languages, Loader2, Columns2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useVersionStore } from "../../stores/versionStore";
import {
  translateSubtitles,
  cancelTranslation,
  localModelStatus,
  downloadLocalModel,
  type LocalModelInfo,
} from "../../lib/tauri-commands";
import { formatError } from "../../lib/error-format";
import type { TranslationProgress, TranslationProvider } from "../../types/subtitle";

const PROVIDER_OPTIONS = ["gemini", "claude", "local"] as const;
const LANGUAGE_OPTIONS = [
  "EN",
  "PL",
  "DE",
  "FR",
  "ES",
  "IT",
  "PT",
  "NL",
  "JA",
  "KO",
  "ZH",
  "RU",
  "UK",
] as const;

export default function TranslationPanel() {
  const { t } = useTranslation(["translation", "common"]);
  const {
    translationProvider,
    setTranslationProvider,
    hasGeminiKey,
    hasClaudeKey,
    geminiModel,
    autoSaveOnTranslation,
  } = useSettingsStore();
  const { addVersion } = useVersionStore();
  const {
    subtitles,
    setSubtitles,
    originalSubtitles,
    setOriginalSubtitles,
    clearOriginalSubtitles,
    comparisonMode,
    setComparisonMode,
  } = useSubtitleStore();

  const [targetLang, setTargetLang] = useState("EN");
  const [sourceLang, setSourceLang] = useState("");
  const [translating, setTranslating] = useState(false);
  const [progress, setProgress] = useState<TranslationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [translated, setTranslated] = useState(false);
  const [localModel, setLocalModel] = useState<LocalModelInfo | null>(null);
  const [downloadingModel, setDownloadingModel] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);

  const isLocal = translationProvider === "local";

  useEffect(() => {
    if (!isLocal) return;
    localModelStatus()
      .then(setLocalModel)
      .catch(() => setLocalModel(null));
  }, [isLocal]);

  const handleCancelTranslation = async () => {
    try {
      await cancelTranslation();
    } catch (e) {
      console.error("Cancel translation failed:", e);
    }
  };

  const handleDownloadModel = async () => {
    setDownloadingModel(true);
    setError(null);
    setModelProgress(0);
    try {
      await downloadLocalModel((p) => setModelProgress(p));
      setLocalModel(await localModelStatus());
    } catch (e) {
      setError(formatError(t, e));
    } finally {
      setDownloadingModel(false);
    }
  };

  const hasKey = isLocal
    ? true // the local model needs no API key
    : translationProvider === "gemini"
    ? hasGeminiKey
    : hasClaudeKey;
  // TranslateGemma has no source auto-detect, so "local" requires an explicit source.
  const localNeedsSource = isLocal && !sourceLang;
  const localNeedsModel = isLocal && !(localModel?.downloaded ?? false);
  const canTranslate =
    subtitles.length > 0 && hasKey && !localNeedsSource && !localNeedsModel;

  const handleTranslate = async () => {
    if (!canTranslate) return;
    setTranslating(true);
    setError(null);
    setProgress(null);
    try {
      // Snapshot originals before translation
      setOriginalSubtitles([...subtitles]);

      const result = await translateSubtitles(
        subtitles,
        targetLang,
        translationProvider,
        sourceLang || undefined,
        translationProvider === "gemini" ? geminiModel : undefined,
        (p) => setProgress(p)
      );
      // Not auto-saved to history → mark dirty so the unsaved translation isn't lost on close.
      setSubtitles(result, { dirty: !autoSaveOnTranslation });
      if (autoSaveOnTranslation) {
        addVersion(result, "translation", {
          provider: translationProvider,
          targetLang,
          sourceLang: sourceLang || undefined,
          model: translationProvider === "gemini" ? geminiModel : undefined,
        });
      }
      setTranslated(true);
    } catch (e) {
      setError(formatError(t, e));
      // Clear snapshot on failure
      clearOriginalSubtitles();
    } finally {
      setTranslating(false);
      setProgress(null);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <Languages size={16} />
        {t("translation:header")}
      </h3>

      {/* Provider */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
          {t("translation:providerLabel")}
        </label>
        <select
          value={translationProvider}
          onChange={(e) => setTranslationProvider(e.target.value as TranslationProvider)}
          className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
          disabled={translating}
        >
          {PROVIDER_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {t(`translation:provider.${p}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Target language */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
          {t("translation:targetLanguageLabel")}
        </label>
        <select
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
          disabled={translating}
        >
          {LANGUAGE_OPTIONS.map((code) => (
            <option key={code} value={code}>
              {t(`translation:language.${code}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Source language (optional) */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
          {t("translation:sourceLanguageLabel")}
        </label>
        <select
          value={sourceLang}
          onChange={(e) => setSourceLang(e.target.value)}
          className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
          disabled={translating}
        >
          <option value="">{t("translation:sourceAuto")}</option>
          {LANGUAGE_OPTIONS.map((code) => (
            <option key={code} value={code}>
              {t(`translation:language.${code}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Local model download (one-time, ~2.3 GB) */}
      {isLocal && localModel && !localModel.downloaded && (
        <div className="space-y-1">
          {downloadingModel ? (
            <>
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <Loader2 size={14} className="animate-spin" />
                {t("translation:localModel.downloading", {
                  percent: Math.round(modelProgress * 100),
                })}
              </div>
              <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-[width] duration-300"
                  style={{ width: `${modelProgress * 100}%` }}
                />
              </div>
            </>
          ) : (
            <button
              onClick={() => void handleDownloadModel()}
              className="flex items-center gap-2 w-full justify-center rounded-lg bg-blue-500 hover:bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              <Download size={16} />
              {t("translation:localModel.download", {
                size: (localModel.sizeMb / 1024).toFixed(1),
              })}
            </button>
          )}
        </div>
      )}

      {/* Translate / Cancel button */}
      {translating ? (
        <button
          onClick={handleCancelTranslation}
          className="flex items-center gap-2 w-full justify-center rounded-lg bg-red-500 hover:bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          <X size={16} />
          {t("translation:cancel")}
        </button>
      ) : (
        <button
          onClick={handleTranslate}
          disabled={!canTranslate || downloadingModel}
          className="flex items-center gap-2 w-full justify-center rounded-lg bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 dark:disabled:bg-purple-800 px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          <Languages size={16} />
          {t("translation:translate", { count: subtitles.length })}
        </button>
      )}

      {/* Translation progress */}
      {translating && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Loader2 size={14} className="animate-spin" />
            {progress && progress.total > 0
              ? t("translation:progress", { done: progress.done, total: progress.total })
              : t("translation:translating")}
          </div>
          {progress && progress.total > 0 && (
            <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                className="h-full bg-purple-500 transition-[width] duration-300"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Comparison toggle */}
      {translated && originalSubtitles && (
        <div className="space-y-2">
          <button
            onClick={() => setComparisonMode(!comparisonMode)}
            className={`flex items-center gap-2 w-full justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              comparisonMode
                ? "bg-amber-500 hover:bg-amber-600 text-white"
                : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            }`}
          >
            {comparisonMode ? (
              <>
                <X size={16} />
                {t("translation:hideComparison")}
              </>
            ) : (
              <>
                <Columns2 size={16} />
                {t("translation:compare")}
              </>
            )}
          </button>

          {!comparisonMode && (
            <div className="flex gap-2">
              {/* Keep the translation: drop the pre-translation snapshot. */}
              <button
                onClick={() => {
                  clearOriginalSubtitles();
                  setTranslated(false);
                }}
                className="flex-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                {t("translation:keepTranslation")}
              </button>
              {/* Reject the translation: bring the original text back. */}
              <button
                onClick={() => {
                  if (!originalSubtitles) return;
                  setSubtitles(originalSubtitles, { dirty: true });
                  clearOriginalSubtitles();
                  setTranslated(false);
                }}
                className="flex-1 text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
              >
                {t("translation:restoreOriginal")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Warnings */}
      {!hasKey && !isLocal && (
        <p className="text-xs text-amber-500 dark:text-amber-400 text-center">
          {t("translation:apiKeyMissing", {
            provider: t(`translation:providerName.${translationProvider}`),
          })}
        </p>
      )}
      {localNeedsSource && !localNeedsModel && (
        <p className="text-xs text-amber-500 dark:text-amber-400 text-center">
          {t("translation:localModel.needsSource")}
        </p>
      )}
      {isLocal && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500 text-center leading-relaxed">
          {t("translation:localModel.gemmaNotice")}
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
