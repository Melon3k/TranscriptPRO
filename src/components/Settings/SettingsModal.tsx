import { X, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUpdateStore } from "../../stores/updateStore";
import { checkForUpdates } from "../../lib/updater";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white dark:bg-gray-800 shadow-2xl border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Settings</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-5">
          {/* Gemini API Key */}
          <ApiKeyField
            label="Gemini API Key"
            value={geminiApiKey}
            onChange={setGeminiApiKey}
            placeholder="AIzaSy..."
          />

          {/* Gemini Model */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
              Gemini Model
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
            label="Claude API Key"
            value={claudeApiKey}
            onChange={setClaudeApiKey}
            placeholder="sk-ant-api03-..."
          />

          {/* LibreTranslate */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              LibreTranslate (Free)
            </p>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
                Server URL
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
              label="API Key (optional)"
              value={libreTranslateApiKey}
              onChange={setLibreTranslateApiKey}
              placeholder="Leave empty for public server"
            />
          </div>

          {/* Version history */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-2.5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Historia wersji
            </p>
            {([
              ["Auto-zapisuj po transkrypcji", autoSaveOnTranscription, setAutoSaveOnTranscription],
              ["Auto-zapisuj po tłumaczeniu", autoSaveOnTranslation, setAutoSaveOnTranslation],
              ["Auto-zapisuj po imporcie SRT", autoSaveOnImport, setAutoSaveOnImport],
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

          {/* Aktualizacje */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-2.5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Aktualizacje
            </p>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Wersja aplikacji
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
                Automatycznie sprawdzaj aktualizacje
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
                Sprawdź teraz
              </button>
              {updateStatus === "up-to-date" && (
                <span className="text-xs text-green-600 dark:text-green-400">
                  Masz najnowszą wersję
                </span>
              )}
              {updateStatus === "checking" && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Sprawdzanie…
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-blue-500 hover:bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors"
          >
            Done
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
