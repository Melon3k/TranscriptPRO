import { useEffect, useState, type CSSProperties } from "react";
import { Download, Languages, Columns2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useVersionStore } from "../../stores/versionStore";
import { useNotifyStore } from "../../stores/notifyStore";
import {
  translateSubtitles, cancelTranslation, localModelStatus,
  downloadLocalModel, cancelLocalModelDownload, type LocalModelInfo,
} from "../../lib/tauri-commands";
import { formatError, isCancellation } from "../../lib/error-format";
import type { TranslationProgress, TranslationProvider } from "../../types/subtitle";
import { COLORS, f, primaryBtn } from "../../lib/ui";
import { FieldLabel, Select } from "../common/Field";
import { ProgressCard } from "../Transcription/TranscriptionPanel";

const PROVIDER_OPTIONS = ["gemini", "claude", "local"] as const;
const LANGUAGE_OPTIONS = ["EN", "PL", "DE", "FR", "ES", "IT", "PT", "NL", "JA", "KO", "ZH", "RU", "UK"] as const;

export default function TranslationPanel() {
  const { t } = useTranslation(["translation", "common"]);
  const { translationProvider, setTranslationProvider, hasGeminiKey, hasClaudeKey, geminiModel, autoSaveOnTranslation } =
    useSettingsStore();
  const { addVersion } = useVersionStore();
  const {
    subtitles, setSubtitles, originalSubtitles, setOriginalSubtitles,
    clearOriginalSubtitles, comparisonMode, setComparisonMode,
  } = useSubtitleStore();
  const notify = useNotifyStore((s) => s.notify);

  const [targetLang, setTargetLang] = useState("EN");
  const [sourceLang, setSourceLang] = useState("");
  const [translating, setTranslating] = useState(false);
  const [progress, setProgress] = useState<TranslationProgress | null>(null);
  const [translated, setTranslated] = useState(false);
  const [localModel, setLocalModel] = useState<LocalModelInfo | null>(null);
  const [downloadingModel, setDownloadingModel] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);

  const isLocal = translationProvider === "local";

  useEffect(() => {
    if (!isLocal) return;
    localModelStatus().then(setLocalModel).catch(() => setLocalModel(null));
  }, [isLocal]);

  const hasKey = isLocal ? true : translationProvider === "gemini" ? hasGeminiKey : hasClaudeKey;
  const localNeedsSource = isLocal && !sourceLang;
  const localNeedsModel = isLocal && !(localModel?.downloaded ?? false);
  const canTranslate = subtitles.length > 0 && hasKey && !localNeedsSource && !localNeedsModel;

  const handleDownloadModel = async () => {
    setDownloadingModel(true); setModelProgress(0);
    try { await downloadLocalModel(setModelProgress); setLocalModel(await localModelStatus()); }
    catch (e) {
      if (isCancellation(e)) setLocalModel(await localModelStatus().catch(() => null));
      else notify("error", formatError(t, e));
    } finally { setDownloadingModel(false); }
  };
  const handleCancelDownload = async () => {
    try { await cancelLocalModelDownload(); } catch (e) { console.error("Cancel model download failed:", e); }
  };
  const handleCancelTranslation = async () => {
    try { await cancelTranslation(); } catch (e) { console.error("Cancel translation failed:", e); }
  };

  const handleTranslate = async () => {
    if (!canTranslate) return;
    setTranslating(true); setProgress(null);
    try {
      setOriginalSubtitles([...subtitles]);
      const result = await translateSubtitles(
        subtitles, targetLang, translationProvider, sourceLang || undefined,
        translationProvider === "gemini" ? geminiModel : undefined, setProgress,
      );
      if (result.translatedCount === 0) {
        notify("error", result.warning ?? t("translation:nothingTranslated"));
        clearOriginalSubtitles();
        return;
      }
      setSubtitles(result.subtitles, { dirty: !autoSaveOnTranslation });
      setTranslated(true);
      setComparisonMode(true);
      if (result.warning) {
        notify("error", t("translation:partialWarning", { done: result.translatedCount, total: subtitles.length }));
      } else {
        if (autoSaveOnTranslation) {
          addVersion(result.subtitles, "translation", {
            provider: translationProvider, targetLang,
            sourceLang: sourceLang || undefined,
            model: translationProvider === "gemini" ? geminiModel : undefined,
          });
        }
        notify("success", t("translation:doneNotice", { done: result.translatedCount, total: subtitles.length }));
      }
    } catch (e) {
      notify("error", formatError(t, e));
      clearOriginalSubtitles();
    } finally {
      setTranslating(false); setProgress(null);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Languages size={17} color={COLORS.violetLight} />
        <span style={f(600, 15, "display")}>{t("translation:header")}</span>
      </div>

      <FieldLabel>{t("translation:providerLabel")}</FieldLabel>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {PROVIDER_OPTIONS.map((p) => {
          const active = translationProvider === p;
          return (
            <button
              key={p}
              onClick={() => !translating && setTranslationProvider(p as TranslationProvider)}
              disabled={translating}
              title={t(`translation:provider.${p}`)}
              style={{
                flex: 1, minWidth: 0, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: 7, cursor: translating ? "not-allowed" : "pointer", whiteSpace: "nowrap",
                background: active ? "rgba(124,58,237,.16)" : "var(--c-raised)",
                border: `1px solid ${active ? COLORS.violet : "var(--c-border)"}`,
                color: active ? "#c4b5fd" : "var(--c-text2)", ...f(600, 11),
              }}
            >
              {t(`translation:providerName.${p}`)}
            </button>
          );
        })}
      </div>

      <div style={{ marginBottom: 12 }}>
        <FieldLabel>{t("translation:targetLanguageLabel")}</FieldLabel>
        <Select value={targetLang} disabled={translating} onChange={(e) => setTargetLang(e.target.value)}>
          {LANGUAGE_OPTIONS.map((c) => <option key={c} value={c}>{t(`translation:language.${c}`)}</option>)}
        </Select>
      </div>
      <div style={{ marginBottom: 16 }}>
        <FieldLabel>{t("translation:sourceLanguageLabel")}</FieldLabel>
        <Select value={sourceLang} disabled={translating} onChange={(e) => setSourceLang(e.target.value)}>
          <option value="">{t("translation:sourceAuto")}</option>
          {LANGUAGE_OPTIONS.map((c) => <option key={c} value={c}>{t(`translation:language.${c}`)}</option>)}
        </Select>
      </div>

      {isLocal && localModel && !localModel.downloaded && (
        <div style={{ marginBottom: 14 }}>
          {downloadingModel ? (
            <>
              <ProgressCard label={t("translation:localModel.downloading", { percent: Math.round(modelProgress * 100) })} percent={Math.round(modelProgress * 100)} accent={COLORS.violet} />
              <button onClick={handleCancelDownload} style={{ ...ghostLink, marginTop: 8 }}>
                <X size={13} />{t("translation:cancel")}
              </button>
            </>
          ) : (
            <>
              <p style={{ ...noteBox, marginBottom: 8 }}>{t("translation:localModel.gemmaConsent")}</p>
              <button onClick={handleDownloadModel} style={primaryBtn(COLORS.blue)}>
                <Download size={16} />{t("translation:localModel.download", { size: (localModel.sizeMb / 1024).toFixed(1) })}
              </button>
            </>
          )}
        </div>
      )}

      {translating ? (
        <>
          <button onClick={handleCancelTranslation} style={{ ...dangerBtn, marginBottom: 14 }}>
            <X size={15} />{t("translation:cancel")}
          </button>
          <ProgressCard
            label={progress && progress.total > 0 ? t("translation:progress", { done: progress.done, total: progress.total }) : t("translation:translating")}
            percent={progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null}
            accent={COLORS.violet}
          />
        </>
      ) : (
        <button onClick={handleTranslate} disabled={!canTranslate || downloadingModel} style={primaryBtn(COLORS.violet, !canTranslate || downloadingModel)}>
          <Languages size={15} />{t("translation:translate", { count: subtitles.length })}
        </button>
      )}

      {translated && originalSubtitles && !translating && (
        <div style={{ marginTop: 12 }}>
          <button onClick={() => setComparisonMode(!comparisonMode)} style={{ ...secondaryBtn, height: 38, marginBottom: 10 }}>
            <Columns2 size={14} />
            {comparisonMode ? t("translation:hideComparison") : t("translation:compare")}
          </button>
          <div style={{ display: "flex", gap: 9 }}>
            <button
              onClick={() => { clearOriginalSubtitles(); setTranslated(false); }}
              style={{ ...secondaryBtn, flex: 1, height: 36 }}
            >
              {t("translation:keepTranslation")}
            </button>
            <button
              onClick={() => {
                if (!originalSubtitles) return;
                setSubtitles(originalSubtitles, { dirty: true });
                clearOriginalSubtitles();
                setTranslated(false);
              }}
              style={{ ...secondaryBtn, flex: 1, height: 36 }}
            >
              {t("translation:restoreOriginal")}
            </button>
          </div>
        </div>
      )}

      {!hasKey && !isLocal && (
        <p style={warnText}>{t("translation:apiKeyMissing", { provider: t(`translation:providerName.${translationProvider}`) })}</p>
      )}
      {localNeedsSource && !localNeedsModel && <p style={warnText}>{t("translation:localModel.needsSource")}</p>}
      {isLocal && localModel?.downloaded && (
        <p style={f(400, 10, "body", { color: "var(--c-muted)", textAlign: "center", lineHeight: 1.5, marginTop: 10 })}>
          {t("translation:localModel.gemmaNotice")}
        </p>
      )}
    </div>
  );
}

const secondaryBtn: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%",
  background: "var(--c-raised)", border: "1px solid var(--c-border)", borderRadius: 9,
  color: "var(--c-text)", cursor: "pointer", fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 12,
};
const dangerBtn: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: 42,
  background: "rgba(240,67,91,.12)", border: "1px solid rgba(240,67,91,.4)", borderRadius: 9,
  color: COLORS.red, cursor: "pointer", fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 13,
};
const ghostLink: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 5, width: "100%",
  background: "none", border: "none", color: "var(--c-muted)", cursor: "pointer",
  fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 11,
};
const noteBox: CSSProperties = {
  ...f(400, 11, "body", { color: "var(--c-text2)", lineHeight: 1.5 }),
  background: "var(--c-input)", border: "1px solid var(--c-border)", borderRadius: 8, padding: "8px 11px", margin: 0,
};
const warnText: CSSProperties = { ...f(400, 11, "body", { color: COLORS.amber, textAlign: "center", marginTop: 10 }) };
