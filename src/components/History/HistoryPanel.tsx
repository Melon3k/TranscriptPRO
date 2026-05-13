import { useState } from "react";
import {
  Mic,
  Languages,
  FileAudio,
  Save,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Clock,
  GitCompare,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useVersionStore } from "../../stores/versionStore";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { SubtitleVersion, VersionAction } from "../../types/version";
import { Subtitle } from "../../types/subtitle";
import { formatTimestamp } from "../../lib/time-format";
import { diffSubtitles, SubtitleDiff, DiffToken } from "../../lib/diff";

function actionIcon(action: VersionAction) {
  switch (action) {
    case "transcription": return <Mic size={13} />;
    case "translation": return <Languages size={13} />;
    case "import": return <FileAudio size={13} />;
    case "manual": return <Save size={13} />;
  }
}

function formatTs(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleString(locale === "pl" ? "pl-PL" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TokenSpan({ token }: { token: DiffToken }) {
  if (token.tag === "equal") {
    return <span>{token.text}</span>;
  }
  if (token.tag === "insert") {
    return (
      <span className="bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300 rounded px-0.5">
        {token.text}
      </span>
    );
  }
  return (
    <span className="bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400 line-through rounded px-0.5">
      {token.text}
    </span>
  );
}

function DiffRow({ diff }: { diff: SubtitleDiff }) {
  const rowBg =
    diff.status === "added"
      ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
      : diff.status === "removed"
      ? "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
      : diff.status === "changed"
      ? "bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-700"
      : "border-gray-100 dark:border-gray-700";

  return (
    <div className={`px-2 py-1.5 border-b text-xs ${rowBg}`}>
      <div className="flex items-start gap-2">
        <span className="shrink-0 text-gray-400 dark:text-gray-500 font-mono tabular-nums w-5 text-right">
          {diff.index}
        </span>
        <div className="min-w-0 flex-1">
          {diff.status === "equal" && (
            <span className="text-gray-600 dark:text-gray-400">{diff.leftText}</span>
          )}
          {diff.status === "added" && (
            <span className="text-green-700 dark:text-green-400">+ {diff.rightText}</span>
          )}
          {diff.status === "removed" && (
            <span className="text-red-600 dark:text-red-400 line-through">− {diff.leftText}</span>
          )}
          {diff.status === "changed" && (
            <div className="space-y-0.5">
              <div className="text-gray-400 dark:text-gray-500 line-through">
                {diff.leftText}
              </div>
              <div className="text-gray-800 dark:text-gray-200 leading-snug">
                {diff.tokens.map((t, i) => (
                  <TokenSpan key={i} token={t} />
                ))}
              </div>
            </div>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500 font-mono">
          {formatTimestamp(diff.startTime).slice(0, 5)}
        </span>
      </div>
    </div>
  );
}

function DiffPanel({
  version,
  current,
  t,
}: {
  version: Subtitle[];
  current: Subtitle[];
  t: TFunction;
}) {
  const diffs = diffSubtitles(current, version);
  const changed = diffs.filter((d) => d.status !== "equal").length;
  const added = diffs.filter((d) => d.status === "added").length;
  const removed = diffs.filter((d) => d.status === "removed").length;
  const modified = diffs.filter((d) => d.status === "changed").length;

  return (
    <div className="mt-2 rounded border border-gray-200 dark:border-gray-600 overflow-hidden">
      {/* Summary bar */}
      <div className="flex items-center gap-3 px-2 py-1 bg-gray-100 dark:bg-gray-700 text-[11px]">
        <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <GitCompare size={11} /> {t("history:diffVsCurrent")}
        </span>
        {changed === 0 ? (
          <span className="text-gray-400">{t("history:noChanges")}</span>
        ) : (
          <>
            {modified > 0 && (
              <span className="text-amber-600 dark:text-amber-400">
                {t("history:modified", { count: modified })}
              </span>
            )}
            {added > 0 && (
              <span className="text-green-600 dark:text-green-400">
                {t("history:added", { count: added })}
              </span>
            )}
            {removed > 0 && (
              <span className="text-red-500 dark:text-red-400">
                {t("history:removed", { count: removed })}
              </span>
            )}
          </>
        )}
      </div>

      {/* Rows — only show non-equal unless all equal */}
      <div className="max-h-64 overflow-y-auto">
        {changed === 0 ? (
          <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500 text-center">
            {t("history:identicalToCurrent")}
          </p>
        ) : (
          diffs
            .filter((d) => d.status !== "equal")
            .map((d) => <DiffRow key={`${d.index}-${d.status}`} diff={d} />)
        )}
      </div>
    </div>
  );
}

function VersionItem({
  version,
  current,
  isPreviewing,
  onTogglePreview,
  onRestore,
  t,
  locale,
}: {
  version: SubtitleVersion;
  current: Subtitle[];
  isPreviewing: boolean;
  onTogglePreview: () => void;
  onRestore: () => void;
  t: TFunction;
  locale: string;
}) {
  return (
    <li className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="flex items-start gap-2 px-2.5 py-2">
        <span className="mt-0.5 shrink-0 text-gray-400 dark:text-gray-500">
          {actionIcon(version.action)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-gray-700 dark:text-gray-200">
            {version.label}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            {formatTs(version.timestamp, locale)} · {version.subtitles.length} {t("history:segmentsShort")}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onRestore}
            title={t("history:restoreTitle")}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium bg-blue-500 hover:bg-blue-600 text-white transition-colors"
          >
            <RotateCcw size={11} />
            {t("history:restore")}
          </button>
          <button
            onClick={onTogglePreview}
            title={isPreviewing ? t("history:hideDiff") : t("history:showDiff")}
            className="rounded p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            {isPreviewing ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      {isPreviewing && (
        <div className="px-2.5 pb-2.5">
          <DiffPanel version={version.subtitles} current={current} t={t} />
        </div>
      )}
    </li>
  );
}

export default function HistoryPanel() {
  const { t } = useTranslation(["history", "common"]);
  const locale = useSettingsStore((s) => s.language);
  const { versions, addVersion, restoreVersion } = useVersionStore();
  const { subtitles, setSubtitles } = useSubtitleStore();
  const [previewId, setPreviewId] = useState<string | null>(null);

  const handleManualSave = () => {
    if (subtitles.length === 0) return;
    addVersion(subtitles, "manual", {});
  };

  const handleTogglePreview = (id: string) => {
    setPreviewId((prev) => (prev === id ? null : id));
  };

  const handleRestore = (id: string) => {
    restoreVersion(id, setSubtitles);
  };

  return (
    <div className="p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Clock size={16} />
          {t("history:header")}
        </h3>
        <button
          onClick={handleManualSave}
          disabled={subtitles.length === 0}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Save size={12} />
          {t("history:saveManual")}
        </button>
      </div>

      {/* Empty state */}
      {versions.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">
          {t("history:empty")}
          <br />
          {t("history:emptyHint")}
        </p>
      )}

      {/* Version list */}
      <ul className="space-y-1.5">
        {versions.map((v) => (
          <VersionItem
            key={v.id}
            version={v}
            current={subtitles}
            isPreviewing={previewId === v.id}
            onTogglePreview={() => handleTogglePreview(v.id)}
            onRestore={() => handleRestore(v.id)}
            t={t}
            locale={locale}
          />
        ))}
      </ul>
    </div>
  );
}
