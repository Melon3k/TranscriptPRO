import { useState } from "react";
import { Languages, Loader2 } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { translateSubtitles } from "../../lib/tauri-commands";

export default function TranslationPanel() {
  const {
    translationProvider,
    setTranslationProvider,
    deeplApiKey,
    googleApiKey,
  } = useSettingsStore();
  const { subtitles, setSubtitles } = useSubtitleStore();

  const [targetLang, setTargetLang] = useState("EN");
  const [sourceLang, setSourceLang] = useState("");
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiKey = translationProvider === "deepl" ? deeplApiKey : googleApiKey;

  const handleTranslate = async () => {
    if (subtitles.length === 0 || !apiKey) return;
    setTranslating(true);
    setError(null);
    try {
      const translated = await translateSubtitles(
        subtitles,
        targetLang,
        translationProvider,
        apiKey,
        sourceLang || undefined
      );
      setSubtitles(translated);
    } catch (e) {
      setError(String(e));
    } finally {
      setTranslating(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <Languages size={16} />
        Translation
      </h3>

      {/* Provider */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
          Provider
        </label>
        <select
          value={translationProvider}
          onChange={(e) => setTranslationProvider(e.target.value as "deepl" | "google")}
          className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
          disabled={translating}
        >
          <option value="deepl">DeepL</option>
          <option value="google">Google Translate</option>
        </select>
      </div>

      {/* Target language */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
          Target language
        </label>
        <select
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
          disabled={translating}
        >
          <option value="EN">English</option>
          <option value="PL">Polish</option>
          <option value="DE">German</option>
          <option value="FR">French</option>
          <option value="ES">Spanish</option>
          <option value="IT">Italian</option>
          <option value="PT">Portuguese</option>
          <option value="NL">Dutch</option>
          <option value="JA">Japanese</option>
          <option value="KO">Korean</option>
          <option value="ZH">Chinese</option>
          <option value="RU">Russian</option>
          <option value="UK">Ukrainian</option>
        </select>
      </div>

      {/* Source language (optional) */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
          Source language (optional)
        </label>
        <select
          value={sourceLang}
          onChange={(e) => setSourceLang(e.target.value)}
          className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
          disabled={translating}
        >
          <option value="">Auto-detect</option>
          <option value="EN">English</option>
          <option value="PL">Polish</option>
          <option value="DE">German</option>
          <option value="FR">French</option>
          <option value="ES">Spanish</option>
          <option value="IT">Italian</option>
          <option value="PT">Portuguese</option>
          <option value="NL">Dutch</option>
          <option value="JA">Japanese</option>
          <option value="KO">Korean</option>
          <option value="ZH">Chinese</option>
          <option value="RU">Russian</option>
          <option value="UK">Ukrainian</option>
        </select>
      </div>

      {/* Translate button */}
      <button
        onClick={handleTranslate}
        disabled={translating || subtitles.length === 0 || !apiKey}
        className="flex items-center gap-2 w-full justify-center rounded-lg bg-purple-500 hover:bg-purple-600 disabled:bg-purple-300 dark:disabled:bg-purple-800 px-4 py-2 text-sm font-medium text-white transition-colors"
      >
        {translating ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Translating...
          </>
        ) : (
          <>
            <Languages size={16} />
            Translate ({subtitles.length} segments)
          </>
        )}
      </button>

      {/* Warnings */}
      {!apiKey && (
        <p className="text-xs text-amber-500 dark:text-amber-400 text-center">
          Set your {translationProvider === "deepl" ? "DeepL" : "Google"} API key in Settings
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
