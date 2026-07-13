import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { setDirty, exitApp, cancelAudioExtraction } from "../../lib/tauri-commands";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { usePlayerStore } from "../../stores/playerStore";
import { useVersionStore } from "../../stores/versionStore";
import { useLogStore, type LogEntry } from "../../stores/logStore";
import { useRecentFilesStore } from "../../stores/recentFilesStore";
import { useOnboardingStore } from "../../stores/onboardingStore";
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
import KeyboardShortcutsModal from "../KeyboardShortcutsModal";
import OnboardingWizard from "../Onboarding/OnboardingWizard";
import { Mic, Languages, History, X, Upload } from "lucide-react";

type SidePanel = "transcription" | "translation" | "history";

export default function MainLayout() {
  const { t } = useTranslation("common");
  const { undo, redo, canUndo, canRedo, setSubtitles, clearOriginalSubtitles } =
    useSubtitleStore();
  const { setFilePath } = usePlayerStore();
  const { setProjectKey, addVersion } = useVersionStore();
  const autoSaveOnImport = useSettingsStore((s) => s.autoSaveOnImport);
  const appendLog = useLogStore((s) => s.append);
  const record = useRecentFilesStore((s) => s.record);
  const onboardingCompleted = useOnboardingStore((s) => s.completed);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<SidePanel>("transcription");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  const handleStartExtraction = useCallback(() => {
    setAudioPath(null);
    setExtracting(true);
    setActivePanel("transcription"); // so the "Extracting…" + Cancel affordance is visible
  }, []);

  const handleTranscriptionReady = useCallback((audio: string) => {
    setAudioPath(audio);
    setActivePanel("transcription");
    setExtracting(false);
    setError(null);
  }, []);

  const handleCancelExtraction = useCallback(async () => {
    // Optimistically clear the UI; the resulting Cancelled error is swallowed in file-routing.
    setExtracting(false);
    try {
      await cancelAudioExtraction();
    } catch (e) {
      console.error("Cancel extraction failed:", e);
    }
  }, []);

  // Transient success notices (e.g. "Exported to …") auto-dismiss after a few seconds.
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const handleDroppedFiles = useCallback(
    async (paths: string[]) => {
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
        clearTranslationState: clearOriginalSubtitles,
        addVersion,
        autoSaveOnImport,
        onStartAudioExtraction: handleStartExtraction,
        onStartTranscription: handleTranscriptionReady,
        onError: (msg) => {
          setError(msg);
          setExtracting(false);
        },
        onRecordFile: record,
      });
    },
    [
      t,
      setFilePath,
      setProjectKey,
      setSubtitles,
      clearOriginalSubtitles,
      addVersion,
      autoSaveOnImport,
      record,
      handleStartExtraction,
      handleTranscriptionReady,
    ],
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

  // Mirror the unsaved-changes flag into native state so the Rust close/quit handlers
  // (including macOS Cmd+Q, which doesn't emit a per-window close event) can guard it.
  useEffect(() => {
    void setDirty(useSubtitleStore.getState().dirty);
    return useSubtitleStore.subscribe((state, prev) => {
      if (state.dirty !== prev.dirty) void setDirty(state.dirty);
    });
  }, []);

  // Rust prevents close/quit when dirty and emits "confirm-close" — show the dialog here;
  // on confirm, clear the guard and exit. A local flag avoids a double dialog if both the
  // window-close and app-quit paths fire.
  useEffect(() => {
    let dialogOpen = false;
    const unlistenPromise = listen("confirm-close", async () => {
      if (dialogOpen) return;
      dialogOpen = true;
      try {
        const confirmed = await ask(t("unsavedQuit"), {
          title: t("unsavedTitle"),
          kind: "warning",
        });
        if (confirmed) {
          await setDirty(false);
          await exitApp();
        }
      } finally {
        dialogOpen = false;
      }
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [t]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (isEditing) return;

      const mod = e.metaKey || e.ctrlKey;

      if (mod && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        if (!canUndo()) return;
        e.preventDefault();
        undo();
      } else if (
        mod &&
        e.shiftKey &&
        (e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y")
      ) {
        if (!canRedo()) return;
        e.preventDefault();
        redo();
      } else if (mod && e.key === "/") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (mod && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
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
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onStartAudioExtraction={handleStartExtraction}
        onStartTranscription={handleTranscriptionReady}
        onError={(msg) => {
          setError(msg);
          setExtracting(false);
        }}
        onNotice={(msg) => setNotice(msg)}
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

      {/* Success notice banner */}
      {notice && (
        <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/30 border-b border-green-200 dark:border-green-800 px-4 py-2 text-xs text-green-700 dark:text-green-300">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} className="text-green-400 hover:text-green-600">
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

          {/* Panel content — all panels stay mounted (toggled via `hidden`) so that
              in-flight state (e.g. the transcription progress bar) survives tab switches.
              Conditionally rendering with `&&` would unmount and wipe that local state. */}
          <div className="flex-1 overflow-y-auto">
            <div className={activePanel === "transcription" ? "" : "hidden"}>
              <TranscriptionPanel
                audioPath={audioPath}
                extracting={extracting}
                onCancelExtraction={handleCancelExtraction}
              />
            </div>
            <div className={activePanel === "translation" ? "" : "hidden"}>
              <TranslationPanel />
            </div>
            <div className={activePanel === "history" ? "" : "hidden"}>
              <HistoryPanel />
            </div>
          </div>
        </div>
      </div>

      {/* Log panel (bottom drawer) */}
      <LogPanel />

      {/* Settings modal */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Keyboard shortcuts modal */}
      <KeyboardShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      {/* Onboarding wizard — shown once on first launch */}
      {!onboardingCompleted && <OnboardingWizard />}

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
