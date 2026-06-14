import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Copy, Check, X, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLogStore, type LogLevel } from "../../stores/logStore";

const LEVEL_STYLES: Record<LogLevel, string> = {
  info: "text-gray-300",
  warn: "text-amber-400",
  error: "text-red-400",
  debug: "text-blue-300",
};

const ALL_LEVELS: LogLevel[] = ["info", "warn", "error", "debug"];

function formatTime(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${d
    .getMilliseconds()
    .toString()
    .padStart(3, "0")}`;
}

export default function LogPanel() {
  const { t } = useTranslation(["logPanel"]);
  const { entries, open, setOpen, clear } = useLogStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // ── Filters ───────────────────────────────────────────────────────────
  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(
    () => new Set(ALL_LEVELS),
  );
  const [sourceFilter, setSourceFilter] = useState("");
  const [search, setSearch] = useState("");

  // Distinct sources present in the current log buffer (for the dropdown).
  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.source);
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (!activeLevels.has(e.level)) return false;
      if (sourceFilter && e.source !== sourceFilter) return false;
      if (
        q &&
        !e.message.toLowerCase().includes(q) &&
        !e.source.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [entries, activeLevels, sourceFilter, search]);

  const toggleLevel = (level: LogLevel) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  const handleCopy = () => {
    const text = filtered
      .map(
        (e) =>
          `${formatTime(e.timestamp)} ${e.level.toUpperCase().padEnd(5)} ${e.source.padEnd(20)} ${e.message}`,
      )
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [filtered, open]);

  if (!open) return null;

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-900 text-gray-100 flex flex-col h-56 shrink-0">
      {/* Row 1 — title, count, actions */}
      <div className="flex items-center gap-2 border-b border-gray-700 px-3 py-1.5 text-xs">
        <span className="font-semibold uppercase tracking-wide text-gray-400">
          {t("logPanel:header")}
        </span>
        <span className="text-gray-500">
          {t("logPanel:shownOfTotal", {
            shown: filtered.length,
            total: entries.length,
          })}
        </span>
        <div className="flex-1" />
        <button
          onClick={handleCopy}
          disabled={filtered.length === 0}
          title={t("logPanel:copy")}
          className="flex items-center gap-1 rounded px-2 py-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          {t("logPanel:copyShort")}
        </button>
        <button
          onClick={clear}
          title={t("logPanel:clear")}
          className="flex items-center gap-1 rounded px-2 py-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
        >
          <Trash2 size={12} />
          {t("logPanel:clearShort")}
        </button>
        <button
          onClick={() => setOpen(false)}
          title={t("logPanel:close")}
          className="flex items-center rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
        >
          <X size={14} />
        </button>
      </div>

      {/* Row 2 — filters: level chips, source, search */}
      <div className="flex items-center gap-2 border-b border-gray-700 px-3 py-1.5 text-xs">
        <div
          className="flex items-center gap-1"
          title={t("logPanel:filterByLevel")}
        >
          {ALL_LEVELS.map((level) => {
            const on = activeLevels.has(level);
            return (
              <button
                key={level}
                onClick={() => toggleLevel(level)}
                aria-pressed={on}
                className={`rounded border px-1.5 py-0.5 uppercase tracking-wide transition-colors ${
                  on
                    ? `${LEVEL_STYLES[level]} border-gray-600 bg-gray-800`
                    : "border-transparent text-gray-600 hover:text-gray-400"
                }`}
              >
                {level}
              </button>
            );
          })}
        </div>

        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          title={t("logPanel:filterBySource")}
          className="max-w-[10rem] rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-gray-300"
        >
          <option value="">{t("logPanel:allSources")}</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <div className="relative flex-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("logPanel:searchPlaceholder")}
            className="w-full rounded border border-gray-700 bg-gray-800 py-0.5 pl-6 pr-2 text-gray-200 placeholder-gray-500"
          />
        </div>
      </div>

      {/* Body */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed px-3 py-2"
      >
        {entries.length === 0 ? (
          <div className="text-gray-500 italic">{t("logPanel:empty")}</div>
        ) : filtered.length === 0 ? (
          <div className="text-gray-500 italic">{t("logPanel:noMatches")}</div>
        ) : (
          filtered.map((entry, i) => (
            <div key={i} className="flex gap-2 whitespace-pre-wrap break-words">
              <span className="text-gray-500 shrink-0">
                {formatTime(entry.timestamp)}
              </span>
              <span
                className={`uppercase shrink-0 w-10 ${
                  LEVEL_STYLES[entry.level] ?? "text-gray-300"
                }`}
              >
                {entry.level}
              </span>
              <span className="text-purple-300 shrink-0 w-20 truncate">
                {entry.source}
              </span>
              <span className={LEVEL_STYLES[entry.level] ?? "text-gray-200"}>
                {entry.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
