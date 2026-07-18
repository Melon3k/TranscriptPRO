import { useEffect, useState } from "react";
import { Settings as SettingsIcon, RefreshCw, Sun, Moon } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
import { useSettingsStore, type UiLanguage } from "../../stores/settingsStore";
import { useUpdateStore } from "../../stores/updateStore";
import { checkForUpdates } from "../../lib/updater";
import { SUPPORTED_LANGUAGES } from "../../i18n";
import { COLORS, f, FONTS, scrim, modalCard } from "../../lib/ui";
import { Select, CheckRow } from "../common/Field";
import { ModalHeader } from "../KeyboardShortcutsModal";
import ApiKeyField from "./ApiKeyField";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: Props) {
  const { t } = useTranslation(["settings", "common", "toolbar"]);
  const {
    geminiModel, setGeminiModel,
    autoSaveOnTranscription, setAutoSaveOnTranscription,
    autoSaveOnTranslation, setAutoSaveOnTranslation,
    autoSaveOnImport, setAutoSaveOnImport,
    autoCheckUpdates, setAutoCheckUpdates,
    language, setLanguage, forceCpu, setForceCpu,
    darkMode, toggleDarkMode,
  } = useSettingsStore();
  const updateStatus = useUpdateStore((s) => s.status);
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    if (!open) return;
    getVersion().then(setAppVersion).catch(() => setAppVersion(""));
  }, [open]);

  if (!open) return null;

  return (
    <div style={scrim} onClick={onClose}>
      <div style={{ ...modalCard(560), maxHeight: 660 }} onClick={(e) => e.stopPropagation()}>
        <ModalHeader icon={<SettingsIcon size={17} color={COLORS.blueLight} />} title={t("settings:title")} onClose={onClose} />

        <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 15 }}>
          {/* Theme */}
          <Row>
            <div style={f(600, 12, "body")}>{t("settings:themeLabel")}</div>
            <div style={{ display: "flex", gap: 3, background: "var(--c-input)", border: "1px solid var(--c-border)", borderRadius: 8, padding: 3 }}>
              <SegBtn active={!darkMode} onClick={() => { if (darkMode) toggleDarkMode(); }} icon={<Sun size={13} />} label={t("settings:themeLight")} />
              <SegBtn active={darkMode} onClick={() => { if (!darkMode) toggleDarkMode(); }} icon={<Moon size={13} />} label={t("settings:themeDark")} />
            </div>
          </Row>

          {/* Language */}
          <div>
            <div style={f(600, 12, "body", { marginBottom: 8 })}>{t("settings:language.label")}</div>
            <Select value={language} onChange={(e) => setLanguage(e.target.value as UiLanguage)}>
              {SUPPORTED_LANGUAGES.map((lng) => <option key={lng} value={lng}>{t(`settings:language.${lng}`)}</option>)}
            </Select>
          </div>

          <Divider />

          <ApiKeyField provider="gemini" label={t("settings:geminiApiKey")} placeholder="AIzaSy..." />

          <div>
            <div style={f(600, 12, "body", { marginBottom: 8 })}>{t("settings:geminiModel")}</div>
            <Select value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)}>
              <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Free tier)</option>
              <option value="gemini-3.5-flash">gemini-3.5-flash (Paid)</option>
              <option value="gemini-2.5-pro">gemini-2.5-pro (Paid)</option>
            </Select>
          </div>

          <ApiKeyField provider="claude" label={t("settings:claudeApiKey")} placeholder="sk-ant-api03-..." />

          <Divider />

          <CheckRow checked={forceCpu} onChange={setForceCpu} label={t("settings:transcription.forceCpu")} hint={t("settings:transcription.forceCpuHint")} />

          <Divider />
          <div style={f(600, 10, "body", { color: "var(--c-muted)", letterSpacing: ".08em", textTransform: "uppercase" })}>
            {t("settings:history.section")}
          </div>
          <CheckRow checked={autoSaveOnTranscription} onChange={setAutoSaveOnTranscription} label={t("settings:history.afterTranscription")} />
          <CheckRow checked={autoSaveOnTranslation} onChange={setAutoSaveOnTranslation} label={t("settings:history.afterTranslation")} />
          <CheckRow checked={autoSaveOnImport} onChange={setAutoSaveOnImport} label={t("settings:history.afterImport")} />

          <Divider />

          <Row>
            <div>
              <div style={f(600, 12, "body")}>
                {t("settings:updates.appVersion")}{" "}
                <span style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: 10, color: "var(--c-muted)" }}>
                  {appVersion ? `v${appVersion}` : "—"}
                </span>
              </div>
              {updateStatus === "up-to-date" && (
                <div style={f(400, 10, "body", { color: COLORS.green, marginTop: 1 })}>{t("settings:updates.upToDate")}</div>
              )}
            </div>
            <button
              onClick={() => void checkForUpdates()}
              disabled={updateStatus === "checking" || updateStatus === "downloading"}
              style={{ display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", background: "var(--c-raised)", border: "1px solid var(--c-border)", borderRadius: 7, cursor: "pointer", ...f(600, 10, "body", { color: "var(--c-text)" }) }}
            >
              <RefreshCw size={12} style={{ animation: updateStatus === "checking" ? "spin 1s linear infinite" : undefined }} />
              {t("settings:updates.checkNow")}
            </button>
          </Row>
          <CheckRow checked={autoCheckUpdates} onChange={setAutoCheckUpdates} label={t("settings:updates.autoCheck")} />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 20px", borderTop: "1px solid var(--c-border)" }}>
          <button
            onClick={onClose}
            style={{ height: 34, padding: "0 20px", display: "flex", alignItems: "center", background: COLORS.blue, border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", ...f(600, 12) }}
          >
            {t("common:done")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>{children}</div>;
}

function SegBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 26,
        padding: "0 12px",
        borderRadius: 6,
        border: "none",
        cursor: "pointer",
        background: active ? COLORS.blue : "transparent",
        color: active ? "#fff" : "var(--c-text2)",
        ...f(600, 11),
      }}
    >
      {icon}
      {label}
    </button>
  );
}
function Divider() {
  return <div style={{ height: 1, background: "var(--c-border)" }} />;
}
