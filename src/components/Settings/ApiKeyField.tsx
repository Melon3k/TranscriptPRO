import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { setApiKey, deleteApiKey, apiKeySavedAt, type ApiKeyProvider } from "../../lib/tauri-commands";
import { formatError } from "../../lib/error-format";
import { COLORS, f, FONTS } from "../../lib/ui";

/**
 * API key entry backed by the OS credential store. The webview never reads the
 * stored key back — when one is present the field shows a "saved" state.
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
  const present = useSettingsStore((s) => (provider === "gemini" ? s.hasGeminiKey : s.hasClaudeKey));
  const setKeyPresence = useSettingsStore((s) => s.setKeyPresence);

  const [draft, setDraft] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!present) { setSavedAt(null); return; }
    apiKeySavedAt(provider).then(setSavedAt).catch(() => setSavedAt(null));
  }, [present, provider]);

  const save = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await setApiKey(provider, draft.trim());
      setKeyPresence(provider, true);
      setDraft(""); setVisible(false);
    } catch (e) { setError(formatError(t, e)); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await deleteApiKey(provider); setKeyPresence(provider, false); }
    catch (e) { setError(formatError(t, e)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div style={f(600, 12, "body", { color: "var(--c-text)", marginBottom: 8 })}>{label}</div>
      {present ? (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 9, height: 36, padding: "0 12px",
            background: "rgba(16,185,129,.08)", border: "1px solid rgba(16,185,129,.35)", borderRadius: 8,
          }}
        >
          <KeyRound size={15} color={COLORS.green} />
          <span style={f(500, 11, "body")}>
            {savedAt
              ? t("settings:apiKey.savedOn", { date: new Date(savedAt * 1000).toLocaleDateString(i18n.language) })
              : t("settings:apiKey.saved")}
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={remove}
            disabled={busy}
            style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", color: COLORS.red, ...f(600, 10) }}
          >
            <Trash2 size={12} />{t("settings:apiKey.remove")}
          </button>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, height: 36, padding: "0 12px", background: "var(--c-input)", border: "1px solid var(--c-border)", borderRadius: 8 }}>
              <input
                type={visible ? "text" : "password"}
                value={draft}
                placeholder={placeholder}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--c-text)", fontFamily: FONTS.mono, fontSize: 11 }}
              />
              <button onClick={() => setVisible(!visible)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-muted)", display: "flex", padding: 0 }}>
                {visible ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <button
              onClick={save}
              disabled={!draft.trim() || busy}
              style={{
                height: 36, padding: "0 16px", display: "flex", alignItems: "center", background: COLORS.blue,
                border: "none", borderRadius: 8, color: "#fff", cursor: !draft.trim() || busy ? "not-allowed" : "pointer",
                opacity: !draft.trim() || busy ? 0.5 : 1, ...f(600, 11),
              }}
            >
              {t("settings:apiKey.save")}
            </button>
          </div>
          <p style={f(400, 11, "body", { color: "var(--c-muted)", marginTop: 6 })}>{t("settings:apiKey.keychainHint")}</p>
        </div>
      )}
      {error && <p style={f(400, 11, "body", { color: COLORS.red, marginTop: 6 })}>{error}</p>}
    </div>
  );
}
