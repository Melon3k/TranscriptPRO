import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLogStore, type LogLevel } from "../../stores/logStore";
import { COLORS, f, FONTS } from "../../lib/ui";

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: "#3B82F6",
  warn: "#B4820F",
  error: COLORS.red,
  debug: COLORS.blueLight,
};
const ALL_LEVELS: LogLevel[] = ["info", "warn", "error", "debug"];

function formatTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Bottom log drawer. */
export default function LogPanel() {
  const { t } = useTranslation(["logPanel"]);
  const { entries, open, setOpen, clear } = useLogStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(() => new Set(ALL_LEVELS));
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (!activeLevels.has(e.level)) return false;
      if (q && !e.message.toLowerCase().includes(q) && !e.source.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, activeLevels, search]);

  const toggleLevel = (level: LogLevel) =>
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });

  const handleCopy = () => {
    const text = filtered.map((e) => `${formatTime(e.timestamp)} ${e.level.toUpperCase()} ${e.source} ${e.message}`).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered, open]);

  if (!open) return null;

  return (
    <div style={{ height: 210, flex: "none", background: "var(--c-panel)", borderTop: "1px solid var(--c-border)", display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div style={{ height: 38, flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "0 14px", borderBottom: "1px solid var(--c-border)" }}>
        <Terminal size={14} color={COLORS.cyan} />
        <span style={f(600, 12, "display", { color: "var(--c-text)" })}>{t("logPanel:header")}</span>
        <span style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: 10, color: "var(--c-muted)" }}>
          {t("logPanel:shownOfTotal", { shown: filtered.length, total: entries.length })}
        </span>
        <div style={{ flex: 1 }} />
        <TextBtn onClick={handleCopy} disabled={filtered.length === 0}>{copied ? "✓" : t("logPanel:copyShort")}</TextBtn>
        <TextBtn onClick={clear}>{t("logPanel:clearShort")}</TextBtn>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-muted)", display: "flex", padding: 0 }}>
          <X size={14} />
        </button>
      </div>

      {/* filters */}
      <div style={{ height: 34, flex: "none", display: "flex", alignItems: "center", gap: 7, padding: "0 14px", borderBottom: "1px solid var(--c-border)" }}>
        {ALL_LEVELS.map((level) => {
          const on = activeLevels.has(level);
          return (
            <button
              key={level}
              onClick={() => toggleLevel(level)}
              style={{
                height: 22, padding: "0 9px", display: "flex", alignItems: "center", borderRadius: 20,
                background: on ? `${LEVEL_COLOR[level]}29` : "var(--c-input)",
                border: `1px solid ${on ? LEVEL_COLOR[level] : "var(--c-border)"}`,
                color: on ? LEVEL_COLOR[level] : "var(--c-muted)", cursor: "pointer", ...f(600, 9),
              }}
            >
              {level}
            </button>
          );
        })}
        <div style={{ flex: 1, maxWidth: 220, display: "flex", alignItems: "center", gap: 6, height: 22, padding: "0 9px", background: "var(--c-input)", border: "1px solid var(--c-border)", borderRadius: 6, color: "var(--c-muted)" }}>
          <Search size={11} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("logPanel:searchPlaceholder")}
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--c-text)", ...f(400, 9) }}
          />
        </div>
      </div>

      {/* body */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "8px 14px", fontFamily: FONTS.mono, fontSize: 10.5, lineHeight: 1.7, color: "var(--c-text2)" }}>
        {entries.length === 0 ? (
          <div style={{ color: "var(--c-muted)", fontStyle: "italic" }}>{t("logPanel:empty")}</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: "var(--c-muted)", fontStyle: "italic" }}>{t("logPanel:noMatches")}</div>
        ) : (
          filtered.map((e, i) => (
            <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              <span style={{ color: "var(--c-muted)" }}>{formatTime(e.timestamp)}</span>{" "}
              <span style={{ color: LEVEL_COLOR[e.level] }}>[{e.level}]</span>{" "}
              <span style={{ color: COLORS.violetLight }}>{e.source}</span>{" "}
              <span>{e.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TextBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ background: "none", border: "none", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1, color: "var(--c-text2)", ...f(600, 10) }}
    >
      {children}
    </button>
  );
}
