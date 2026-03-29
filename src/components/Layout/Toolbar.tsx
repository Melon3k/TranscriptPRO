import {
  FolderOpen,
  FileAudio,
  Download,
  FileText,
  Undo2,
  Redo2,
  Settings,
  Sun,
  Moon,
} from "lucide-react";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  openMediaFileDialog,
  openSrtFileDialog,
  saveSrtFileDialog,
  saveTxtFileDialog,
  importSrt,
  exportSrt,
  exportTxt,
  extractAudio,
} from "../../lib/tauri-commands";
import { usePlayerStore } from "../../stores/playerStore";

interface ToolbarProps {
  onOpenSettings: () => void;
  onStartTranscription: (audioPath: string) => void;
}

export default function Toolbar({ onOpenSettings, onStartTranscription }: ToolbarProps) {
  const { subtitles, setSubtitles, undo, redo, canUndo, canRedo } = useSubtitleStore();
  const { darkMode, toggleDarkMode } = useSettingsStore();
  const { setFilePath } = usePlayerStore();

  const handleOpenMedia = async () => {
    const path = await openMediaFileDialog();
    if (!path) return;
    setFilePath(path);

    try {
      const audioPath = await extractAudio(path);
      onStartTranscription(audioPath);
    } catch (e) {
      console.error("Audio extraction failed:", e);
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
