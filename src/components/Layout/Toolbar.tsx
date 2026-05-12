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
  Terminal,
} from "lucide-react";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useVersionStore } from "../../stores/versionStore";
import { useLogStore } from "../../stores/logStore";
import {
  openMediaFileDialog,
  openSrtFileDialog,
  saveSrtFileDialog,
  saveTxtFileDialog,
  exportSrt,
  exportWordSrt,
  exportTxt,
} from "../../lib/tauri-commands";
import { routeFile } from "../../lib/file-routing";
import { usePlayerStore } from "../../stores/playerStore";

interface ToolbarProps {
  onOpenSettings: () => void;
  onStartTranscription: (audioPath: string) => void;
  onError: (message: string) => void;
}

export default function Toolbar({ onOpenSettings, onStartTranscription, onError }: ToolbarProps) {
  const { subtitles, setSubtitles, undo, redo, canUndo, canRedo } = useSubtitleStore();
  const { darkMode, toggleDarkMode, autoSaveOnImport } = useSettingsStore();
  const { setFilePath } = usePlayerStore();
  const { setProjectKey, addVersion } = useVersionStore();
  const togglePanel = useLogStore((s) => s.togglePanel);
  const logsOpen = useLogStore((s) => s.open);

  const routeCallbacks = {
    setFilePath,
    setProjectKey,
    setSubtitles,
    addVersion,
    autoSaveOnImport,
    onStartTranscription,
    onError: (msg: string) =>
      onError(`Audio extraction failed: ${msg}. Make sure FFmpeg is installed.`),
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
        icon={<Terminal size={16} />}
        label={logsOpen ? "Hide logs" : "Show logs"}
        onClick={togglePanel}
      />
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
