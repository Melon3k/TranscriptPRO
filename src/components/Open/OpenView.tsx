import { Download, Film, FileText, Mic, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRecentFilesStore, type RecentFile } from "../../stores/recentFilesStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { COLORS, f } from "../../lib/ui";

interface OpenViewProps {
  onOpenMedia: () => void;
  onImportSrt: () => void;
  onOpenRecent: (file: RecentFile) => void;
}

const ACCEPTED = "mp4 · mkv · mov · webm · mp3 · wav · flac · m4a · srt";

function filename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function relative(ts: number, lang: string): string {
  const seconds = Math.round((Date.now() - ts) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (seconds < 60) return rtf.format(-seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}

/** The empty-state / file-picker workspace shown in "media" mode. */
export default function OpenView({ onOpenMedia, onImportSrt, onOpenRecent }: OpenViewProps) {
  const { t } = useTranslation(["open", "toolbar"]);
  const files = useRecentFilesStore((s) => s.files);
  const clear = useRecentFilesStore((s) => s.clear);
  const lang = useSettingsStore((s) => s.language);

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
        overflowY: "auto",
      }}
    >
      <div style={{ width: 640, maxWidth: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: 26 }}>
          <span
            style={{
              width: 60,
              height: 60,
              borderRadius: 16,
              background: "var(--gradient-flow)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <Download size={30} color="#fff" />
          </span>
          <div style={f(600, 24, "display", { color: "var(--c-text)" })}>{t("open:title")}</div>
          <div style={f(400, 13, "body", { color: "var(--c-text2)", marginTop: 6, maxWidth: 440, lineHeight: 1.5 })}>
            {t("open:subtitle")}
          </div>
        </div>

        <div
          onClick={onOpenMedia}
          style={{
            border: "1.5px dashed var(--c-border)",
            borderRadius: 14,
            background: "var(--c-panel)",
            padding: "34px 24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
            cursor: "pointer",
          }}
        >
          <Download size={38} color={COLORS.blueLight} />
          <div style={f(500, 13, "body", { color: "var(--c-text)" })}>{t("open:dropHere")}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={(e) => { e.stopPropagation(); onOpenMedia(); }}
              style={{
                height: 38,
                padding: "0 18px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: COLORS.blue,
                border: "none",
                borderRadius: 9,
                color: "#fff",
                cursor: "pointer",
                boxShadow: `0 4px 16px ${COLORS.blue}59`,
                ...f(600, 12),
              }}
            >
              <Film size={14} />
              {t("open:openMedia")}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onImportSrt(); }}
              style={{
                height: 38,
                padding: "0 16px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "var(--c-raised)",
                border: "1px solid var(--c-border)",
                borderRadius: 9,
                color: "var(--c-text2)",
                cursor: "pointer",
                ...f(600, 12),
              }}
            >
              <FileText size={14} />
              {t("open:importSrt")}
            </button>
          </div>
          <div style={f(400, 10, "body", { color: "var(--c-muted)" })}>{ACCEPTED}</div>
        </div>

        {files.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={f(600, 10, "body", { letterSpacing: ".1em", color: "var(--c-muted)" })}>
                {t("open:recent")}
              </span>
              <button
                onClick={clear}
                style={{ background: "none", border: "none", cursor: "pointer", ...f(500, 10, "body", { color: "var(--c-text2)" }) }}
              >
                {t("open:clear")}
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {files.map((file) => (
                <button
                  key={file.path}
                  onClick={() => onOpenRecent(file)}
                  title={file.path}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    padding: "10px 12px",
                    background: "var(--c-panel)",
                    border: "1px solid var(--c-border)",
                    borderRadius: 9,
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: "var(--c-raised)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: COLORS.blueLight,
                      flex: "none",
                    }}
                  >
                    {file.kind === "media" ? <Mic size={15} /> : <FileText size={15} />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={f(500, 12, "body", { color: "var(--c-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" })}>
                      {filename(file.path)}
                    </div>
                    <div style={f(400, 10, "body", { color: "var(--c-muted)" })}>{relative(file.openedAt, lang)}</div>
                  </div>
                  <ChevronRight size={14} color="var(--c-muted)" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
