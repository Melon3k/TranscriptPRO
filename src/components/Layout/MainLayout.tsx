import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { usePlayerStore } from "../../stores/playerStore";
import { useVersionStore } from "../../stores/versionStore";
import { useLogStore, type LogEntry } from "../../stores/logStore";
import { useFileDrop } from "../../hooks/useFileDrop";
import { routeFile, classifyFile } from "../../lib/file-routing";
import Toolbar from "./Toolbar";
import Player from "../Player/Player";
import SubtitleEditor from "../Editor/SubtitleEditor";
import TranscriptionPanel from "../Transcription/TranscriptionPanel";
import TranslationPanel from "../Translation/TranslationPanel";
import HistoryPanel from "../History/HistoryPanel";
import LogPanel from "../LogPanel/LogPanel";
import SettingsModal from "../Settings/SettingsModal";
import { Mic, Languages, History, X, Upload } from "lucide-react";

type SidePanel = "transcription" | "translation" | "history";

export default function MainLayout() {
  const { t } = useTranslation("common");
  const { undo, redo, canUndo, canRedo, setSubtitles } = useSubtitleStore();
  const { setFilePath } = usePlayerStore();
  const { setProjectKey, addVersion } = useVersionStore();
  const autoSaveOnImport = useSettingsStore((s) => s.autoSaveOnImport);
  const appendLog = useLogStore((s) => s.append);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<SidePanel>("transcription");
  const [error, setError] = useState<string | null>(null);

  const handleDroppedFiles = useCallback(
    async (paths: string[]) => {
      // Find the first file the app knows how to handle. Bulk-drop of multiple
      // media files isn't a coherent operation here (we only have one player).
      const supported = paths.find((p) => classifyFile(p) !== "unsupported");
      if (!supported) {
        const exts = paths
          .map((p) => p.split(".").pop()?.toLowerCase() ?? "?")
          .join(", ");
        setError(t("unsupportedFileFormat", { exts }));
        return;
      }
      setError(null);
      await routeFile(supported, {
        setFilePath,
        setProjectKey,
        setSubtitles,
        addVersion,
        autoSaveOnImport,
        onStartTranscription: (audio) => {
          setAudioPath(audio);
          setActivePanel("transcription");
        },
        onError: (msg) => setError(msg),
      });
    },
    [t, setFilePath, setProjectKey, setSubtitles, addVersion, autoSaveOnImport],
  );

  const { isDragging } = useFileDrop(handleDroppedFiles);

  useEffect(() => {
    const unlistenPromise = listen<LogEntry>("app-log", (event) => {
      appendLog(event.payload);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [appendLog]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (isEditing) return;

      if (e.metaKey && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        if (!canUndo()) return;
        e.preventDefault();
        undo();
      } else if (
        e.metaKey &&
        e.shiftKey &&
        (e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y")
      ) {
        if (!canRedo()) return;
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, canUndo, canRedo]);

  return (
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Toolbar */}
      <Toolbar
        onOpenSettings={() => setSettingsOpen(true)}
        onStartTranscription={(path) => {
          setAudioPath(path);
          setActivePanel("transcription");
          setError(null);
        }}
        onError={(msg) => setError(msg)}
      />

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 px-4 py-2 text-xs text-red-700 dark:text-red-300">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Editor + Player */}
        <div className="flex flex-1 flex-col min-w-0">
          <Player />
          <SubtitleEditor />
        </div>

        {/* Right: Side panel */}
        <div className="w-72 shrink-0 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col overflow-hidden">
          {/* Panel tabs */}
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            <PanelTab
              icon={<Mic size={14} />}
              label={t("transcribe")}
              active={activePanel === "transcription"}
              onClick={() => setActivePanel("transcription")}
            />
            <PanelTab
              icon={<Languages size={14} />}
              label={t("translate")}
              active={activePanel === "translation"}
              onClick={() => setActivePanel("translation")}
            />
            <PanelTab
              icon={<History size={14} />}
              label={t("history")}
              active={activePanel === "history"}
              onClick={() => setActivePanel("history")}
            />
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-y-auto">
            {activePanel === "transcription" && (
              <TranscriptionPanel audioPath={audioPath} />
            )}
            {activePanel === "translation" && <TranslationPanel />}
            {activePanel === "history" && <HistoryPanel />}
          </div>
        </div>
      </div>

      {/* Log panel (bottom drawer) */}
      <LogPanel />

      {/* Settings modal */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Drag-and-drop overlay */}
      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-blue-500/10 backdrop-blur-sm border-4 border-dashed border-blue-500 rounded-lg">
          <div className="flex flex-col items-center gap-3 rounded-xl bg-white/95 dark:bg-gray-800/95 px-8 py-6 shadow-2xl border border-blue-300 dark:border-blue-700">
            <Upload size={36} className="text-blue-500" />
            <div className="text-center">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {t("dropFileToOpen")}
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("dropFileHint")}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PanelTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex-1 min-w-0 flex items-center justify-center gap-1 px-1.5 py-2 text-xs font-medium transition-colors ${
        active
          ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-500"
          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
