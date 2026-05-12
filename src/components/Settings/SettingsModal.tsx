import { X, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
import { useSettingsStore, type UiLanguage } from "../../stores/settingsStore";
import { useUpdateStore } from "../../stores/updateStore";
import { checkForUpdates } from "../../lib/updater";
import { SUPPORTED_LANGUAGES } from "../../i18n";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t } = useTranslation(["settings", "common"]);
  const {
    geminiApiKey,
    setGeminiApiKey,
    claudeApiKey,
    setClaudeApiKey,
    geminiModel,
    setGeminiModel,
    libreTranslateUrl,
    setLibreTranslateUrl,
    libreTranslateApiKey,
    setLibreTranslateApiKey,
    autoSaveOnTranscription,
    setAutoSaveOnTranscription,
    autoSaveOnTranslation,
    setAutoSaveOnTranslation,
    autoSaveOnImport,
    setAutoSaveOnImport,
    autoCheckUpdates,
    setAutoCheckUpdates,
    language,
    setLanguage,
  } = useSettingsStore();

  const updateStatus = useUpdateStore((s) => s.status);
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion(""));
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-md max-h-[90vh] flex-col rounded-xl bg-white dark:bg-gray-800 shadow-2xl border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 dark:border-gray-700 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t("settings:title")}</h2>
          <button
            onClick={onClose}
            aria-label={t("common:close")}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Language switcher — top of modal so users can find it from any locale */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("settings:language.label")}
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as UiLanguage)}
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              {SUPPORTED_LANGUAGES.map((lng) => (
                <option key={lng} value={lng}>
                  {t(`settings:language.${lng}`)}
                </option>
              ))}
            </select>
          </div>

          {/* Gemini API Key */}
          <ApiKeyField
            label={t("settings:geminiApiKey")}
            value={geminiApiKey}
            onChange={setGeminiApiKey}
            placeholder="AIzaSy..."
          />

          {/* Gemini Model */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("settings:geminiModel")}
            </label>
            <select
              value={geminiModel}
              onChange={(e) => setGeminiModel(e.target.value)}
              className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              <option value="gemini-2.0-flash-lite">gemini-2.0-flash-lite (Free tier)</option>
              <option value="gemini-1.5-flash">gemini-1.5-flash (Free tier)</option>
              <option value="gemini-2.0-flash">gemini-2.0-flash (Paid)</option>
              <option value="gemini-1.5-pro">gemini-1.5-pro (Paid)</option>
            </select>
          </div>

          {/* Claude API Key */}
          <ApiKeyField
            label={t("settings:claudeApiKey")}
            value={claudeApiKey}
            onChange={setClaudeApiKey}
            placeholder="sk-ant-api03-..."
          />

          {/* LibreTranslate */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t("settings:libreTranslate.section")}
            </p>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                {t("settings:libreTranslate.serverUrl")}
              </label>
              <input
                type="text"
                value={libreTranslateUrl}
                onChange={(e) => setLibreTranslateUrl(e.target.value)}
                placeholder="https://libretranslate.com"
                className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <ApiKeyField
              label={t("settings:libreTranslate.apiKey")}
              value={libreTranslateApiKey}
              onChange={setLibreTranslateApiKey}
              placeholder={t("settings:libreTranslate.apiKeyPlaceholder")}
            />
          </div>

          {/* Version history */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-2.5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t("settings:history.section")}
            </p>
            {([
              [t("settings:history.afterTranscription"), autoSaveOnTranscription, setAutoSaveOnTranscription],
              [t("settings:history.afterTranslation"), autoSaveOnTranslation, setAutoSaveOnTranslation],
              [t("settings:history.afterImport"), autoSaveOnImport, setAutoSaveOnImport],
            ] as [string, boolean, (v: boolean) => void][]).map(([label, value, setter]) => (
              <label key={label} className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => setter(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-400"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
              </label>
            ))}
          </div>

          {/* Updates */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-2.5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t("settings:updates.section")}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t("settings:updates.appVersion")}
              </span>
              <span className="text-sm font-mono text-gray-500 dark:text-gray-400">
                {appVersion ? `v${appVersion}` : "—"}
              </span>
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoCheckUpdates}
                onChange={(e) => setAutoCheckUpdates(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-400"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t("settings:updates.autoCheck")}
              </span>
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void checkForUpdates()}
                disabled={updateStatus === "checking" || updateStatus === "downloading"}
                className="inline-flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw
                  size={12}
                  className={updateStatus === "checking" ? "animate-spin" : ""}
                />
                {t("settings:updates.checkNow")}
              </button>
              {updateStatus === "up-to-date" && (
                <span className="text-xs text-green-600 dark:text-green-400">
                  {t("settings:updates.upToDate")}
                </span>
              )}
              {updateStatus === "checking" && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("settings:updates.checking")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 px-5 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-blue-500 hover:bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors"
          >
            {t("common:done")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ApiKeyField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </label>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 pl-3 pr-9 py-1.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}
