import { X, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
import { useSettingsStore, type UiLanguage } from "../../stores/settingsStore";
import { useUpdateStore } from "../../stores/updateStore";
import { checkForUpdates } from "../../lib/updater";
import { SUPPORTED_LANGUAGES } from "../../i18n";
import ApiKeyField from "./ApiKeyField";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t } = useTranslation(["settings", "common"]);
  const {
    geminiModel,
    setGeminiModel,
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
    forceCpu,
    setForceCpu,
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
            provider="gemini"
            label={t("settings:geminiApiKey")}
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
              <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Free tier)</option>
              <option value="gemini-3.5-flash">gemini-3.5-flash (Paid)</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro (Paid)</option>
            </select>
          </div>

          {/* Claude API Key */}
          <ApiKeyField
            provider="claude"
            label={t("settings:claudeApiKey")}
            placeholder="sk-ant-api03-..."
          />

          {/* Transcription */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-2.5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t("settings:transcription.section")}
            </p>
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={forceCpu}
                onChange={(e) => setForceCpu(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-400"
              />
              <div>
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {t("settings:transcription.forceCpu")}
                </span>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {t("settings:transcription.forceCpuHint")}
                </p>
              </div>
            </label>
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

