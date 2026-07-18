import { useState, useEffect } from "react";
import { Mic, Download, X, Scissors } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettingsStore, type SegmentLimitModeSetting } from "../../stores/settingsStore";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useVersionStore } from "../../stores/versionStore";
import { useNotifyStore } from "../../stores/notifyStore";
import { listModels, downloadModel, transcribeAudio, cancelTranscription } from "../../lib/tauri-commands";
import { resegmentByLength, type SegmentLimit } from "../../lib/subtitle-ops";
import { formatError, isCancellation } from "../../lib/error-format";
import type { WhisperModelInfo, TranscriptionProgress } from "../../types/subtitle";
import { COLORS, f, primaryBtn } from "../../lib/ui";
import { FieldLabel, Select, CheckRow } from "../common/Field";

// Whisper's auto-detect is unreliable, so a language must be picked (no "auto").
// Full official 99-code Whisper set, common languages first.
export const LANGUAGE_OPTIONS = [
  "en", "pl", "de", "es", "fr", "it", "pt", "nl", "ru", "uk", "ja", "ko", "zh",
  "af", "am", "ar", "as", "az", "ba", "be", "bg", "bn", "bo", "br", "bs", "ca",
  "cs", "cy", "da", "el", "et", "eu", "fa", "fi", "fo", "gl", "gu", "ha", "haw",
  "he", "hi", "hr", "ht", "hu", "hy", "id", "is", "ka", "kk", "km", "kn", "la",
  "lb", "ln", "lo", "lt", "lv", "mg", "mi", "mk", "ml", "mn", "mr", "ms", "mt",
  "my", "ne", "nn", "no", "oc", "pa", "ps", "ro", "sa", "sd", "si", "sk", "sl",
  "sn", "so", "sq", "sr", "su", "sv", "sw", "ta", "te", "tg", "th", "tk", "tl",
  "tr", "tt", "ur", "uz", "vi", "yi", "yo", "yue",
] as const;

interface TranscriptionPanelProps {
  audioPath: string | null;
  extracting: boolean;
  onCancelExtraction: () => void;
}

export default function TranscriptionPanel({ audioPath, extracting, onCancelExtraction }: TranscriptionPanelProps) {
  const { t } = useTranslation(["transcription", "common"]);
  const {
    whisperModel, setWhisperModel, autoSaveOnTranscription, forceCpu,
    segmentLimitMode, segmentMaxWords, segmentMaxChars,
    setSegmentLimitMode, setSegmentMaxWords, setSegmentMaxChars,
    transcriptionLanguage: language, setTranscriptionLanguage: setLanguage,
  } = useSettingsStore();
  const { setSubtitles, clearOriginalSubtitles, resegment } = useSubtitleStore();
  const hasSubtitles = useSubtitleStore((s) => s.subtitles.length > 0);
  const { addVersion } = useVersionStore();
  const notify = useNotifyStore((s) => s.notify);

  const segmentLimit: SegmentLimit | null =
    segmentLimitMode === "off"
      ? null
      : { mode: segmentLimitMode, value: segmentLimitMode === "words" ? segmentMaxWords : segmentMaxChars };

  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [detectSpeakers, setDetectSpeakers] = useState(false);

  useEffect(() => { void loadModels(); }, []);
  const loadModels = async () => {
    try { setModels(await listModels()); } catch (e) { console.error("Failed to list models:", e); }
  };
  const selectedModel = models.find((m) => m.name === whisperModel);

  const handleDownload = async () => {
    setDownloading(true); setDownloadProgress(0);
    try { await downloadModel(whisperModel, setDownloadProgress); await loadModels(); }
    catch (e) { notify("error", formatError(t, e)); }
    finally { setDownloading(false); }
  };

  const handleTranscribe = async () => {
    if (!audioPath || !language) return;
    setTranscribing(true); setProgress(null);
    try {
      let subs = await transcribeAudio(audioPath, whisperModel, language, detectSpeakers, forceCpu, setProgress);
      clearOriginalSubtitles();
      if (segmentLimit) subs = resegmentByLength(subs, segmentLimit);
      setSubtitles(subs, { dirty: !autoSaveOnTranscription });
      if (autoSaveOnTranscription) addVersion(subs, "transcription", { whisperModel, language });
      notify("success", t("transcription:doneNotice", { count: subs.length }));
    } catch (e) {
      if (isCancellation(e)) {
        setProgress({ stage: "cancelled", progress: 0, message: t("errors:CANCELLED", { ns: "errors" }) });
        notify("error", t("transcription:cancelledNotice"));
      } else {
        notify("error", formatError(t, e));
      }
    } finally {
      setTranscribing(false);
    }
  };

  const handleCancel = async () => {
    try { await cancelTranscription(); } catch (e) { console.error("Cancel failed:", e); }
  };

  const modelDownloaded = selectedModel?.downloaded ?? true;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Mic size={17} color={COLORS.cyan} />
        <span style={f(600, 15, "display")}>{t("transcription:header")}</span>
      </div>

      <FieldLabel>{t("transcription:modelLabel")}</FieldLabel>
      <div style={{ marginBottom: 14 }}>
        <Select value={whisperModel} disabled={transcribing} onChange={(e) => setWhisperModel(e.target.value)}>
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name} ({m.sizeMb} MB){m.downloaded ? " ✓" : ""}
            </option>
          ))}
        </Select>
        {selectedModel && !selectedModel.downloaded && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            style={{ ...secondaryBtn, marginTop: 8 }}
          >
            {downloading ? (
              <><Spinner />{t("transcription:downloading", { percent: Math.round(downloadProgress * 100) })}</>
            ) : (
              <><Download size={14} />{t("transcription:downloadModel", { sizeMb: selectedModel.sizeMb })}</>
            )}
          </button>
        )}
      </div>

      <FieldLabel>{t("transcription:languageLabel")}</FieldLabel>
      <div style={{ marginBottom: 14 }}>
        <Select value={language} disabled={transcribing} onChange={(e) => setLanguage(e.target.value)}>
          <option value="" disabled>{t("transcription:languagePlaceholder")}</option>
          {LANGUAGE_OPTIONS.map((code) => (
            <option key={code} value={code}>{t(`transcription:language.${code}`)}</option>
          ))}
        </Select>
      </div>

      <FieldLabel>{t("transcription:segmentLimitLabel")}</FieldLabel>
      <div style={{ display: "flex", gap: 8, marginBottom: segmentLimit ? 8 : 16 }}>
        <div style={{ flex: 2, minWidth: 0 }}>
          <Select value={segmentLimitMode} disabled={transcribing} onChange={(e) => setSegmentLimitMode(e.target.value as SegmentLimitModeSetting)}>
            <option value="off">{t("transcription:segmentLimit.off")}</option>
            <option value="words">{t("transcription:segmentLimit.words")}</option>
            <option value="chars">{t("transcription:segmentLimit.chars")}</option>
          </Select>
        </div>
        {segmentLimit && (
          <input
            type="number"
            min={1}
            max={segmentLimitMode === "words" ? 30 : 200}
            value={segmentLimit.value}
            disabled={transcribing}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isNaN(v)) return;
              if (segmentLimitMode === "words") setSegmentMaxWords(v);
              else setSegmentMaxChars(v);
            }}
            style={{
              width: 60, height: 34, textAlign: "center", background: "var(--c-input)",
              border: "1px solid var(--c-border)", borderRadius: 7, color: "var(--c-text)",
              fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: 12, outline: "none",
            }}
          />
        )}
      </div>
      {segmentLimit && (
        <div style={{ marginBottom: 16 }}>
          <p style={f(400, 11, "body", { color: "var(--c-muted)", lineHeight: 1.4, margin: "0 0 8px" })}>
            {t("transcription:segmentLimitHint")}
          </p>
          {hasSubtitles && !transcribing && (
            <button onClick={() => resegment(segmentLimit)} style={secondaryBtn}>
              <Scissors size={14} />
              {t("transcription:applySegmentLimit")}
            </button>
          )}
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <CheckRow checked={detectSpeakers} disabled={transcribing} onChange={setDetectSpeakers} label={t("transcription:detectSpeakers")} />
      </div>

      {transcribing ? (
        <>
          <button onClick={handleCancel} style={{ ...dangerBtn, marginBottom: 14 }}>
            <X size={15} />{t("transcription:cancel")}
          </button>
          <ProgressCard
            label={progress ? t(`transcription:progress.${progress.stage}`, {
              percent: Math.round(progress.progress * 100),
              index: progress.index ?? 0, total: progress.total ?? 0, count: progress.total ?? 0,
              defaultValue: progress.message,
            }) : t("transcription:progress.transcribing_audio", { percent: 0 })}
            percent={progress ? Math.round(progress.progress * 100) : 0}
            accent={COLORS.cyan}
          />
        </>
      ) : extracting ? (
        <>
          <ProgressCard label={t("transcription:extractingAudio")} percent={null} accent={COLORS.cyan} />
          <button onClick={onCancelExtraction} style={{ ...dangerBtn, marginTop: 12 }}>
            <X size={15} />{t("transcription:cancel")}
          </button>
        </>
      ) : (
        <>
          <button
            onClick={handleTranscribe}
            disabled={!audioPath || !language || !modelDownloaded}
            style={primaryBtn(COLORS.blue, !audioPath || !language || !modelDownloaded)}
          >
            <Mic size={15} />{t("transcription:transcribe")}
          </button>
          {audioPath && !language && (
            <p style={f(400, 11, "body", { color: "var(--c-muted)", textAlign: "center", marginTop: 8 })}>
              {t("transcription:selectLanguageHint")}
            </p>
          )}
          {!audioPath && (
            <p style={f(400, 11, "body", { color: "var(--c-muted)", textAlign: "center", marginTop: 8 })}>
              {t("transcription:emptyState")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

const secondaryBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", height: 34,
  background: "var(--c-raised)", border: "1px solid var(--c-border)", borderRadius: 7,
  color: "var(--c-text2)", cursor: "pointer", fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 11,
};

const dangerBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", height: 42,
  background: "rgba(240,67,91,.12)", border: "1px solid rgba(240,67,91,.4)", borderRadius: 9,
  color: COLORS.red, cursor: "pointer", fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: 13,
};

function Spinner({ color = COLORS.cyan }: { color?: string }) {
  return (
    <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${color}`, borderTopColor: "transparent", animation: "spin .8s linear infinite", display: "inline-block" }} />
  );
}

export function ProgressCard({ label, percent, accent }: { label: string; percent: number | null; accent: string }) {
  return (
    <div style={{ background: "var(--c-input)", border: "1px solid var(--c-border)", borderRadius: 9, padding: 13 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
        <Spinner color={accent} />
        <span style={f(500, 11, "body")}>{label}</span>
        {percent !== null && (
          <span style={{ marginLeft: "auto", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: 11, color: accent }}>{percent}%</span>
        )}
      </div>
      <div style={{ height: 5, borderRadius: 3, background: "var(--c-border)", position: "relative", overflow: "hidden" }}>
        <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: percent !== null ? `${percent}%` : "40%", background: accent, borderRadius: 3 }} />
      </div>
    </div>
  );
}
