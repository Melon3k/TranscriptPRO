import { useState } from "react";
import { Languages, Loader2, Columns2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useVersionStore } from "../../stores/versionStore";
import { translateSubtitles } from "../../lib/tauri-commands";
import { formatError } from "../../lib/error-format";

const PROVIDER_OPTIONS = ["libretranslate", "gemini", "claude"] as const;
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
    geminiApiKey,
    claudeApiKey,
    geminiModel,
    libreTranslateUrl,
    libreTranslateApiKey,
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
  const [error, setError] = useState<string | null>(null);
  const [translated, setTranslated] = useState(false);

  const apiKey =
    translationProvider === "gemini"
      ? geminiApiKey
      : translationProvider === "claude"
      ? claudeApiKey
      : libreTranslateApiKey; // LibreTranslate: empty key is OK

  const handleTranslate = async () => {
    if (subtitles.length === 0) return;
    // LibreTranslate doesn't require an API key
    if (!apiKey && translationProvider !== "libretranslate") return;
    setTranslating(true);
    setError(null);
    try {
      // Snapshot originals before translation
      setOriginalSubtitles([...subtitles]);

      const result = await translateSubtitles(
        subtitles,
        targetLang,
        translationProvider,
        apiKey,
        sourceLang || undefined,
        translationProvider === "gemini" ? geminiModel : undefined,
        translationProvider === "libretranslate" ? libreTranslateUrl : undefined
      );
      setSubtitles(result);
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
          onChange={(e) => setTranslationProvider(e.target.value as "gemini" | "claude" | "libretranslate")}
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

      {/* Translate button */}
      <button
        onClick={handleTranslate}
        disabled={
          translating ||
          subtitles.length === 0 ||
          (!apiKey && translationProvider !== "libretranslate")
        }
        className="flex items-center gap-2 w-full justify-center rounded-lg bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 dark:disabled:bg-purple-800 px-4 py-2 text-sm font-medium text-white transition-colors"
      >
        {translating ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {t("translation:translating")}
          </>
        ) : (
          <>
            <Languages size={16} />
            {t("translation:translate", { count: subtitles.length })}
          </>
        )}
      </button>

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
            <button
              onClick={() => {
                clearOriginalSubtitles();
                setTranslated(false);
              }}
              className="w-full text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              {t("translation:dismissOriginal")}
            </button>
          )}
        </div>
      )}

      {/* Warnings */}
      {!apiKey && translationProvider !== "libretranslate" && (
        <p className="text-xs text-amber-500 dark:text-amber-400 text-center">
          {t("translation:apiKeyMissing", {
            provider: t(`translation:providerName.${translationProvider}`),
          })}
        </p>
      )}
      {translationProvider === "libretranslate" && (
        <p className="text-xs text-green-600 dark:text-green-400 text-center">
          {t("translation:freeNoKey")}
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
