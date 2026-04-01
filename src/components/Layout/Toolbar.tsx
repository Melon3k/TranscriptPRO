import { useState } from "react";
import {
  FolderOpen,
  FileAudio,
  Download,
  FileText,
  AlignLeft,
  Undo2,
  Redo2,
  Settings,
  Sun,
  Moon,
  Film,
  Loader2,
} from "lucide-react";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { usePremiereStore } from "../../stores/premiereStore";
import {
  openMediaFileDialog,
  openSrtFileDialog,
  saveSrtFileDialog,
  saveTxtFileDialog,
  importSrt,
  exportSrt,
  exportWordSrt,
  exportTxt,
  extractAudio,
  sendToPremiere,
  revealInFinder,
  pushSubtitlesToPremiere,
} from "../../lib/tauri-commands";
import { usePlayerStore } from "../../stores/playerStore";

interface ToolbarProps {
  onOpenSettings: () => void;
  onStartTranscription: (audioPath: string) => void;
  onError: (message: string) => void;
}

export default function Toolbar({ onOpenSettings, onStartTranscription, onError }: ToolbarProps) {
  const { subtitles, setSubtitles, undo, redo, canUndo, canRedo } = useSubtitleStore();
  const { darkMode, toggleDarkMode } = useSettingsStore();
  const { setFilePath } = usePlayerStore();
  const { status: premiereStatus } = usePremiereStore();

  const [premiereSending, setPremiereSending] = useState(false);
  const [srtPath, setSrtPath] = useState<string | null>(null);

  const handleOpenMedia = async () => {
    const path = await openMediaFileDialog();
    if (!path) return;
    setFilePath(path);

    try {
      const audioPath = await extractAudio(path);
      onStartTranscription(audioPath);
    } catch (e) {
      onError(`Audio extraction failed: ${e}. Make sure FFmpeg is installed.`);
    }
  };

  const handleImportSrt = async () => {
    const path = await openSrtFileDialog();
    if (!path) return;
    try {
      const subs = await importSrt(path);
      setSubtitles(subs);
    } catch (e) {
      console.error("SRT import failed:", e);
    }
  };

  const handleExportSrt = async () => {
    if (subtitles.length === 0) return;
    const path = await saveSrtFileDialog();
    if (!path) return;
    try {
      await exportSrt(path, subtitles);
    } catch (e) {
      console.error("SRT export failed:", e);
    }
  };

  const handleExportWordSrt = async () => {
    if (subtitles.length === 0) return;
    const path = await saveSrtFileDialog("subtitles-words.srt");
    if (!path) return;
    try {
      await exportWordSrt(path, subtitles);
    } catch (e) {
      console.error("Word SRT export failed:", e);
    }
  };

  const handleExportTxt = async () => {
    if (subtitles.length === 0) return;
    const path = await saveTxtFileDialog();
    if (!path) return;
    try {
      await exportTxt(path, subtitles);
    } catch (e) {
      console.error("TXT export failed:", e);
    }
  };

  const handleSendToPremiere = async () => {
    if (subtitles.length === 0) return;
    setPremiereSending(true);
    setSrtPath(null);
    try {
      const path = await sendToPremiere(subtitles);
      setSrtPath(path);
      // Success — Premiere imported the file
    } catch (e) {
      const errMsg = String(e);
      // Extract SRT path from error for fallback UI
      const match = errMsg.match(/SRT saved at: ([^\n]+)/);
      if (match) {
        setSrtPath(match[1].trim());
        onError(`Premiere not found. SRT ready — click the film icon to reveal it in Finder.`);
      } else {
        onError(`Send to Premiere failed: ${errMsg}`);
      }
    } finally {
      setPremiereSending(false);
    }
  };

  const handleSyncPremiere = async () => {
    if (subtitles.length === 0) return;
    try {
      await pushSubtitlesToPremiere(subtitles);
    } catch (e) {
      onError(`Premiere sync failed: ${e}`);
    }
  };

  return (
    <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5">
      {/* File operations */}
      <ToolbarButton icon={<FolderOpen size={16} />} label="Open Media" onClick={handleOpenMedia} />
      <ToolbarButton icon={<FileAudio size={16} />} label="Import SRT" onClick={handleImportSrt} />
      <ToolbarDivider />
      <ToolbarButton
        icon={<Download size={16} />}
        label="Export SRT"
        onClick={handleExportSrt}
        disabled={subtitles.length === 0}
      />
      <ToolbarButton
        icon={<AlignLeft size={16} />}
        label="Word SRT"
        onClick={handleExportWordSrt}
        disabled={subtitles.length === 0}
      />
      <ToolbarButton
        icon={<FileText size={16} />}
        label="Export TXT"
        onClick={handleExportTxt}
        disabled={subtitles.length === 0}
      />
      <ToolbarDivider />

      {/* Premiere Pro integration */}
      <ToolbarButton
        icon={premiereSending ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}
        label={premiereSending ? "Sending..." : "Send to Premiere"}
        onClick={handleSendToPremiere}
        disabled={subtitles.length === 0 || premiereSending}
      />
      {/* Reveal in Finder fallback */}
      {srtPath && (
        <button
          onClick={() => revealInFinder(srtPath)}
          title={`Reveal SRT in Finder: ${srtPath}`}
          className="text-[10px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 px-1 underline"
        >
          Reveal
        </button>
      )}
      {/* Phase 9: Sync button (only when UXP plugin is connected) */}
      {premiereStatus === "plugin-connected" && (
        <ToolbarButton
          icon={<Film size={16} />}
          label="Sync Premiere"
          onClick={handleSyncPremiere}
          disabled={subtitles.length === 0}
        />
      )}
      {/* Phase 9: Connection status dot */}
      {premiereStatus === "server-running" && (
        <span
          className="w-2 h-2 rounded-full bg-yellow-400 shrink-0"
          title="Waiting for Premiere UXP plugin"
        />
      )}
      {premiereStatus === "plugin-connected" && (
        <span
          className="w-2 h-2 rounded-full bg-green-400 shrink-0"
          title="Premiere Pro connected"
        />
      )}
      <ToolbarDivider />

      {/* Undo / Redo */}
      <ToolbarButton
        icon={<Undo2 size={16} />}
        label="Undo"
        onClick={undo}
        disabled={!canUndo()}
      />
      <ToolbarButton
        icon={<Redo2 size={16} />}
        label="Redo"
        onClick={redo}
        disabled={!canRedo()}
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side */}
      <ToolbarButton
        icon={darkMode ? <Sun size={16} /> : <Moon size={16} />}
        label={darkMode ? "Light mode" : "Dark mode"}
        onClick={toggleDarkMode}
      />
      <ToolbarButton icon={<Settings size={16} />} label="Settings" onClick={onOpenSettings} />
    </div>
  );
}

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
