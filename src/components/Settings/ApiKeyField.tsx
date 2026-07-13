import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  setApiKey,
  deleteApiKey,
  apiKeySavedAt,
  type ApiKeyProvider,
} from "../../lib/tauri-commands";
import { formatError } from "../../lib/error-format";

/**
 * API key entry backed by the OS credential store. The webview never reads the
 * stored key back — when one is present the field shows a "saved" state with a
 * remove button instead of the value.
 */
export default function ApiKeyField({
  provider,
  label,
  placeholder,
}: {
  provider: ApiKeyProvider;
  label: string;
  placeholder: string;
}) {
  const { t, i18n } = useTranslation(["settings"]);
  const present = useSettingsStore((s) =>
    provider === "gemini" ? s.hasGeminiKey : s.hasClaudeKey
  );
  const setKeyPresence = useSettingsStore((s) => s.setKeyPresence);

  const [draft, setDraft] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Load the save date when a key is present, so the user can confirm which key
  // is stored (the value itself never leaves the backend).
  useEffect(() => {
    if (!present) {
      setSavedAt(null);
      return;
    }
    apiKeySavedAt(provider).then(setSavedAt).catch(() => setSavedAt(null));
  }, [present, provider]);

  const save = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setApiKey(provider, draft.trim());
      setKeyPresence(provider, true);
      setDraft("");
      setVisible(false);
    } catch (e) {
      setError(formatError(t, e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteApiKey(provider);
      setKeyPresence(provider, false);
    } catch (e) {
      setError(formatError(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </label>

      {present ? (
        <div className="flex items-center justify-between rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 px-3 py-1.5">
          <span className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <KeyRound size={14} className="text-green-600 dark:text-green-400" />
            {savedAt
              ? t("settings:apiKey.savedOn", {
                  date: new Date(savedAt * 1000).toLocaleDateString(
                    i18n.language
                  ),
                })
              : t("settings:apiKey.saved")}
          </span>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
          >
            <Trash2 size={13} />
            {t("settings:apiKey.remove")}
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={visible ? "text" : "password"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
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
          <button
            type="button"
            onClick={() => void save()}
            disabled={!draft.trim() || busy}
            className="flex items-center gap-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {t("settings:apiKey.save")}
          </button>
        </div>
      )}

      {!present && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          {t("settings:apiKey.keychainHint")}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
