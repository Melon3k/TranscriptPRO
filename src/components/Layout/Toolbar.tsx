import { useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  FileAudio,
  Download,
  ChevronDown,
  Clock,
  Undo2,
  Redo2,
  Settings,
  Sun,
  Moon,
  Terminal,
  Keyboard,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useVersionStore } from "../../stores/versionStore";
import { useLogStore } from "../../stores/logStore";
import { useRecentFilesStore, type RecentFile } from "../../stores/recentFilesStore";
import {
  openMediaFileDialog,
  openSrtFileDialog,
  saveSrtFileDialog,
  saveTxtFileDialog,
  saveVttFileDialog,
  saveAssFileDialog,
  exportSrt,
  exportWordSrt,
  exportTxt,
  exportVtt,
  exportAss,
} from "../../lib/tauri-commands";
import { routeFile, type FileRoutingCallbacks } from "../../lib/file-routing";
import { formatError } from "../../lib/error-format";
import { usePlayerStore } from "../../stores/playerStore";
import { Subtitle } from "../../types/subtitle";

interface ToolbarProps {
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onStartAudioExtraction?: () => void;
  onStartTranscription: (audioPath: string) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

export default function Toolbar({
  onOpenSettings,
  onOpenShortcuts,
  onStartAudioExtraction,
  onStartTranscription,
  onError,
  onNotice,
}: ToolbarProps) {
  const { t } = useTranslation(["toolbar", "common"]);
  const { subtitles, setSubtitles, undo, redo, canUndo, canRedo } = useSubtitleStore();
  const { darkMode, toggleDarkMode, autoSaveOnImport } = useSettingsStore();
  const { setFilePath } = usePlayerStore();
  const { setProjectKey, addVersion } = useVersionStore();
  const togglePanel = useLogStore((s) => s.togglePanel);
  const logsOpen = useLogStore((s) => s.open);
  const record = useRecentFilesStore((s) => s.record);

  const routeCallbacks: FileRoutingCallbacks = {
    setFilePath,
    setProjectKey,
    setSubtitles,
    addVersion,
    autoSaveOnImport,
    onStartAudioExtraction,
    onStartTranscription,
    onError,
    onRecordFile: record,
  };

  const handleOpenMedia = async () => {
    const path = await openMediaFileDialog();
    if (!path) return;
    await routeFile(path, routeCallbacks);
  };

  const handleImportSrt = async () => {
    const path = await openSrtFileDialog();
    if (!path) return;
    await routeFile(path, routeCallbacks);
  };

  return (
    <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5">
      {/* File operations */}
      <ToolbarButton icon={<FolderOpen size={16} />} label={t("toolbar:openMedia")} onClick={handleOpenMedia} />
      <ToolbarButton icon={<FileAudio size={16} />} label={t("toolbar:importSrt")} onClick={handleImportSrt} />
      <RecentFilesDropdown routeCallbacks={routeCallbacks} />
      <ToolbarDivider />
      <ExportDropdown
        subtitles={subtitles}
        disabled={subtitles.length === 0}
        onError={onError}
        onNotice={onNotice}
      />
      <ToolbarDivider />

      {/* Undo / Redo */}
      <ToolbarButton
        icon={<Undo2 size={16} />}
        label={t("toolbar:undo")}
        onClick={undo}
        disabled={!canUndo()}
      />
      <ToolbarButton
        icon={<Redo2 size={16} />}
        label={t("toolbar:redo")}
        onClick={redo}
        disabled={!canRedo()}
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side */}
      <ToolbarButton
        icon={<Keyboard size={16} />}
        label={t("toolbar:shortcuts")}
        onClick={onOpenShortcuts}
      />
      <ToolbarButton
        icon={<Terminal size={16} />}
        label={logsOpen ? t("toolbar:hideLogs") : t("toolbar:showLogs")}
        onClick={togglePanel}
      />
      <ToolbarButton
        icon={darkMode ? <Sun size={16} /> : <Moon size={16} />}
        label={darkMode ? t("toolbar:lightMode") : t("toolbar:darkMode")}
        onClick={toggleDarkMode}
      />
      <ToolbarButton icon={<Settings size={16} />} label={t("toolbar:settings")} onClick={onOpenSettings} />
    </div>
  );
}

// ── Recent files dropdown ─────────────────────────────────────────────────────

function formatRelativeTime(timestamp: number, lang: string): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (seconds < 60) return rtf.format(-seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}

function filename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function RecentFilesDropdown({ routeCallbacks }: { routeCallbacks: FileRoutingCallbacks }) {
  const { t } = useTranslation(["toolbar"]);
  const { files, clear } = useRecentFilesStore();
  const language = useSettingsStore((s) => s.language);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  async function openRecent(file: RecentFile) {
    setOpen(false);
    await routeFile(file.path, routeCallbacks);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={t("toolbar:recentFiles")}
        className="flex items-center gap-1 rounded px-2 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <Clock size={14} />
        <ChevronDown size={11} className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[220px] max-w-[320px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1">
          {files.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
              {t("toolbar:noRecentFiles")}
            </p>
          ) : (
            <>
              {files.map((f) => (
                <button
                  key={f.path}
                  onClick={() => openRecent(f)}
                  title={f.path}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center justify-between gap-2"
                >
                  <span className="truncate flex-1">{filename(f.path)}</span>
                  <span className="shrink-0 text-gray-400 dark:text-gray-500">
                    {formatRelativeTime(f.openedAt, language)}
                  </span>
                </button>
              ))}
              <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1">
                <button
                  onClick={() => { clear(); setOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  {t("toolbar:clearRecent")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Export dropdown ───────────────────────────────────────────────────────────

function ExportDropdown({
  subtitles,
  disabled,
  onError,
  onNotice,
}: {
  subtitles: Subtitle[];
  disabled: boolean;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const { t } = useTranslation(["toolbar", "errors"]);
  const markSaved = useSubtitleStore((s) => s.markSaved);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Each handler returns the saved path (or null if the user cancelled the dialog),
  // so `run` can confirm success and surface failures instead of swallowing them.
  // `faithful` = the format round-trips the full editing state (timing + structure), so a
  // successful export means "saved". TXT (no timing) and Word SRT (loses segment grouping
  // on re-import) are lossy, so they must NOT clear the unsaved-changes guard.
  async function run(handler: () => Promise<string | null>, faithful: boolean) {
    setOpen(false);
    try {
      const savedPath = await handler();
      if (savedPath) {
        if (faithful) markSaved();
        onNotice(t("exportSuccess", { name: filename(savedPath) }));
      }
    } catch (e) {
      onError(formatError(t, e));
    }
  }

  const items: { label: string; faithful: boolean; handler: () => Promise<string | null> }[] = [
    {
      label: "SRT",
      faithful: true,
      handler: async () => {
        const path = await saveSrtFileDialog();
        if (path) await exportSrt(path, subtitles);
        return path;
      },
    },
    {
      label: "Word SRT",
      faithful: false,
      handler: async () => {
        const path = await saveSrtFileDialog("subtitles-words.srt");
        if (path) await exportWordSrt(path, subtitles);
        return path;
      },
    },
    {
      label: "VTT",
      faithful: true,
      handler: async () => {
        const path = await saveVttFileDialog();
        if (path) await exportVtt(path, subtitles);
        return path;
      },
    },
    {
      label: "ASS",
      faithful: true,
      handler: async () => {
        const path = await saveAssFileDialog();
        if (path) await exportAss(path, subtitles);
        return path;
      },
    },
    {
      label: "TXT",
      faithful: false,
      handler: async () => {
        const path = await saveTxtFileDialog();
        if (path) await exportTxt(path, subtitles);
        return path;
      },
    },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={t("toolbar:export")}
        className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <Download size={16} />
        <span className="hidden sm:inline">{t("toolbar:export")}</span>
        <ChevronDown
          size={12}
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[110px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => run(item.handler, item.faithful)}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Primitives ────────────────────────────────────────────────────────────────

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function ToolbarDivider() {
  return <div className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-600" />;
}
