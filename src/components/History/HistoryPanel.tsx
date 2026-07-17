import { useMemo, useState } from "react";
import { Mic, Languages, FileText, Save, ChevronDown, RotateCcw, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useVersionStore } from "../../stores/versionStore";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { SubtitleVersion, VersionAction } from "../../types/version";
import { Subtitle } from "../../types/subtitle";
import { diffSubtitles } from "../../lib/diff";
import { COLORS, f, FONTS } from "../../lib/ui";

function actionIcon(action: VersionAction) {
  switch (action) {
    case "transcription": return { icon: <Mic size={13} />, color: COLORS.cyan };
    case "translation": return { icon: <Languages size={13} />, color: COLORS.violetLight };
    case "import": return { icon: <FileText size={13} />, color: COLORS.blueLight };
    case "manual": return { icon: <Save size={13} />, color: "var(--c-muted)" };
  }
}

function formatTs(ts: number, locale: string): string {
  return new Date(ts).toLocaleString(locale === "pl" ? "pl-PL" : "en-US", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export default function HistoryPanel() {
  const { t } = useTranslation(["history", "common"]);
  const locale = useSettingsStore((s) => s.language);
  const { versions, addVersion, restoreVersion } = useVersionStore();
  const { subtitles, setSubtitles, clearOriginalSubtitles } = useSubtitleStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleRestore = (id: string) => {
    clearOriginalSubtitles();
    restoreVersion(id, setSubtitles);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          padding: "15px 16px 13px",
          borderBottom: "1px solid var(--c-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Clock size={16} color={COLORS.amber} />
          <span style={f(600, 15, "display")}>{t("history:header")}</span>
        </div>
        <button
          onClick={() => subtitles.length > 0 && addVersion(subtitles, "manual", {})}
          disabled={subtitles.length === 0}
          style={{
            display: "flex", alignItems: "center", gap: 5, height: 26, padding: "0 10px",
            background: "var(--c-raised)", border: "1px solid var(--c-border)", borderRadius: 7,
            color: "var(--c-text)", cursor: subtitles.length === 0 ? "not-allowed" : "pointer",
            opacity: subtitles.length === 0 ? 0.4 : 1, ...f(600, 10),
          }}
        >
          <Save size={12} />{t("history:saveManual")}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
        {versions.length === 0 ? (
          <p style={f(400, 11, "body", { color: "var(--c-muted)", textAlign: "center", padding: "16px 0", lineHeight: 1.6 })}>
            {t("history:empty")}<br />{t("history:emptyHint")}
          </p>
        ) : (
          versions.map((v) => (
            <VersionCard
              key={v.id}
              version={v}
              current={subtitles}
              expanded={expandedId === v.id}
              locale={locale}
              onToggle={() => setExpandedId((p) => (p === v.id ? null : v.id))}
              onRestore={() => handleRestore(v.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function VersionCard({
  version, current, expanded, locale, onToggle, onRestore,
}: {
  version: SubtitleVersion;
  current: Subtitle[];
  expanded: boolean;
  locale: string;
  onToggle: () => void;
  onRestore: () => void;
}) {
  const { t } = useTranslation(["history"]);
  const { icon, color } = actionIcon(version.action);

  return (
    <div style={{ border: `1px solid ${expanded ? COLORS.amber : "var(--c-border)"}`, borderRadius: 9, background: expanded ? "rgba(245,165,36,.05)" : "var(--c-raised)", overflow: "hidden" }}>
      <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 9 }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: "var(--c-input)", display: "flex", alignItems: "center", justifyContent: "center", color, flex: "none" }}>
          {icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={f(600, 11, "body", { color: "var(--c-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" })}>
            {version.label}
          </div>
          <div style={f(400, 9, "body", { color: "var(--c-muted)" })}>
            {formatTs(version.timestamp, locale)} · {version.subtitles.length} {t("history:segmentsShort")}
          </div>
        </div>
        <button onClick={onRestore} title={t("history:restoreTitle")} style={iconBtn}>
          <RotateCcw size={13} color="var(--c-muted)" />
        </button>
        <button onClick={onToggle} title={expanded ? t("history:hideDiff") : t("history:showDiff")} style={iconBtn}>
          <ChevronDown size={13} color={expanded ? COLORS.amber : "var(--c-muted)"} style={{ transform: expanded ? "rotate(180deg)" : "none" }} />
        </button>
      </div>
      {expanded && <Diff version={version.subtitles} current={current} />}
    </div>
  );
}

function Diff({ version, current }: { version: Subtitle[]; current: Subtitle[] }) {
  const { t } = useTranslation(["history"]);
  const diffs = useMemo(() => diffSubtitles(current, version), [current, version]);
  const modified = diffs.filter((d) => d.status === "changed").length;
  const added = diffs.filter((d) => d.status === "added").length;
  const removed = diffs.filter((d) => d.status === "removed").length;
  const changed = modified + added + removed;

  return (
    <div style={{ borderTop: "1px solid rgba(245,165,36,.25)", padding: "10px 12px", background: "var(--c-input)" }}>
      {changed === 0 ? (
        <p style={f(400, 10, "body", { color: "var(--c-muted)", textAlign: "center", margin: 0 })}>{t("history:identicalToCurrent")}</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            {modified > 0 && <Badge color={COLORS.amber} text={t("history:modified", { count: modified })} />}
            {added > 0 && <Badge color={COLORS.green} text={t("history:added", { count: added })} />}
            {removed > 0 && <Badge color={COLORS.red} text={t("history:removed", { count: removed })} />}
          </div>
          {diffs.filter((d) => d.status !== "equal").slice(0, 40).map((d) => (
            <div key={`${d.index}-${d.status}`} style={{ ...f(400, 11, "body", { color: "var(--c-text2)", lineHeight: 1.6 }), marginBottom: 5 }}>
              <span style={{ fontFamily: FONTS.mono, fontWeight: 600, fontSize: 8, color: "var(--c-muted)", marginRight: 6 }}>{d.index}</span>
              {d.status === "added" && <span style={{ color: "#34d399" }}>+ {d.rightText}</span>}
              {d.status === "removed" && <span style={{ color: "#f0879a", textDecoration: "line-through" }}>− {d.leftText}</span>}
              {d.status === "changed" && d.tokens.map((tok, i) => (
                <span
                  key={i}
                  style={
                    tok.tag === "insert"
                      ? { background: "rgba(16,185,129,.22)", color: "#34d399" }
                      : tok.tag === "delete"
                        ? { background: "rgba(240,67,91,.2)", color: "#f0879a", textDecoration: "line-through" }
                        : undefined
                  }
                >
                  {tok.text}
                </span>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function Badge({ color, text }: { color: string; text: string }) {
  return (
    <span style={{ ...f(600, 9), color, background: `${color}1f`, borderRadius: 5, padding: "2px 7px" }}>{text}</span>
  );
}

const iconBtn: React.CSSProperties = { background: "none", border: "none", cursor: "pointer", padding: 2, display: "flex" };
