import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { ask } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { Upload } from "lucide-react";
import { COLORS, f } from "../../lib/ui";
import {
  setDirty, exitApp, cancelAudioExtraction,
  openMediaFileDialog, openSrtFileDialog,
} from "../../lib/tauri-commands";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { usePlayerStore } from "../../stores/playerStore";
import { useVersionStore } from "../../stores/versionStore";
import { useLogStore, type LogEntry } from "../../stores/logStore";
import { useRecentFilesStore, type RecentFile } from "../../stores/recentFilesStore";
import { useOnboardingStore } from "../../stores/onboardingStore";
import { useNotifyStore } from "../../stores/notifyStore";
import { routeFile, classifyFile, type FileRoutingCallbacks } from "../../lib/file-routing";
import { useFileDrop } from "../../hooks/useFileDrop";
import type { AppMode } from "./modes";
import TitleBar from "./TitleBar";
import Rail from "./Rail";
import Banner from "./Banner";
import OpenView from "../Open/OpenView";
import SubtitleEditor from "../Editor/SubtitleEditor";
import Player from "../Player/Player";
import CompareView from "../Translation/CompareView";
import TranscriptionPanel from "../Transcription/TranscriptionPanel";
import TranslationPanel from "../Translation/TranslationPanel";
import HistoryPanel from "../History/HistoryPanel";
import StylePanel from "../Style/StylePanel";
import LogPanel from "../LogPanel/LogPanel";
import SettingsModal from "../Settings/SettingsModal";
import KeyboardShortcutsModal from "../KeyboardShortcutsModal";
import ExportPreviewModal from "./ExportPreviewModal";
import OnboardingWizard from "../Onboarding/OnboardingWizard";

export default function MainLayout() {
  const { t } = useTranslation(["common"]);
  const darkMode = useSettingsStore((s) => s.darkMode);
  const { undo, redo, canUndo, canRedo, setSubtitles, clearOriginalSubtitles } = useSubtitleStore();
  const comparisonMode = useSubtitleStore((s) => s.comparisonMode);
  const originalSubtitles = useSubtitleStore((s) => s.originalSubtitles);
  const { setFilePath } = usePlayerStore();
  const { setProjectKey, addVersion } = useVersionStore();
  const autoSaveOnImport = useSettingsStore((s) => s.autoSaveOnImport);
  const appendLog = useLogStore((s) => s.append);
  const record = useRecentFilesStore((s) => s.record);
  const onboardingCompleted = useOnboardingStore((s) => s.completed);
  const notify = useNotifyStore((s) => s.notify);

  const [mode, setMode] = useState<AppMode>("media");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  const handleStartExtraction = useCallback(() => {
    setAudioPath(null);
    setExtracting(true);
    setMode("transcribe");
  }, []);

  const handleTranscriptionReady = useCallback((audio: string) => {
    setAudioPath(audio);
    setExtracting(false);
    setMode("transcribe");
  }, []);

  const handleCancelExtraction = useCallback(async () => {
    setExtracting(false);
    try { await cancelAudioExtraction(); } catch (e) { console.error("Cancel extraction failed:", e); }
  }, []);

  const routeCallbacks: FileRoutingCallbacks = {
    setFilePath,
    setProjectKey,
    setSubtitles,
    clearTranslationState: clearOriginalSubtitles,
    addVersion,
    autoSaveOnImport,
    onStartAudioExtraction: handleStartExtraction,
    onStartTranscription: handleTranscriptionReady,
    onError: (msg) => { notify("error", msg); setExtracting(false); },
    onRecordFile: record,
  };

  const openPath = useCallback(
    async (path: string) => {
      const kind = classifyFile(path);
      await routeFile(path, routeCallbacks);
      // Media routes into transcribe via callbacks; SRT lands us on the segment
      // list — switch to a workspace that makes sense for existing subtitles.
      if (kind === "srt") setMode("translate");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autoSaveOnImport],
  );

  const handleOpenMedia = useCallback(async () => {
    const path = await openMediaFileDialog();
    if (path) await openPath(path);
  }, [openPath]);

  const handleImportSrt = useCallback(async () => {
    const path = await openSrtFileDialog();
    if (path) await openPath(path);
  }, [openPath]);

  const handleOpenRecent = useCallback((file: RecentFile) => { void openPath(file.path); }, [openPath]);

  // Native Tauri file drop → the same routing pipeline as the open buttons.
  // routeFile already serializes overlapping media opens, so a drop during
  // an in-flight extraction is safe.
  const handleDroppedPaths = useCallback(
    (paths: string[]) => {
      const supported = paths.find((p) => classifyFile(p) !== "unsupported");
      if (!supported) {
        // Show the extension when there is one, otherwise just the basename —
        // never the full path (folders / extensionless files have no dot).
        const exts = paths
          .map((p) => {
            const name = p.split(/[/\\]/).pop() ?? p;
            const dot = name.lastIndexOf(".");
            return dot > 0 ? name.slice(dot + 1) : name;
          })
          .join(", ");
        notify("error", t("common:unsupportedFileFormat", { exts }));
        return;
      }
      void openPath(supported);
    },
    [openPath, notify, t],
  );
  const { isDragging } = useFileDrop(handleDroppedPaths);

  // Rust `app-log` events → log store.
  useEffect(() => {
    const p = listen<LogEntry>("app-log", (e) => appendLog(e.payload));
    return () => { p.then((un) => un()); };
  }, [appendLog]);

  // Mirror unsaved-changes flag into native state (guards Cmd+Q / quit).
  useEffect(() => {
    void setDirty(useSubtitleStore.getState().dirty);
    return useSubtitleStore.subscribe((state, prev) => {
      if (state.dirty !== prev.dirty) void setDirty(state.dirty);
    });
  }, []);

  // Confirm-close dialog (Rust blocks close/quit while dirty).
  useEffect(() => {
    let dialogOpen = false;
    const p = listen("confirm-close", async () => {
      if (dialogOpen) return;
      dialogOpen = true;
      try {
        const confirmed = await ask(t("unsavedQuit"), { title: t("unsavedTitle"), kind: "warning" });
        if (confirmed) { await setDirty(false); await exitApp(); }
      } finally {
        dialogOpen = false;
      }
    });
    return () => { p.then((un) => un()); };
  }, [t]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        if (!canUndo()) return;
        e.preventDefault(); undo();
      } else if (mod && e.shiftKey && (e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y")) {
        if (!canRedo()) return;
        e.preventDefault(); redo();
      } else if (mod && e.key === "/") {
        e.preventDefault(); setShortcutsOpen((v) => !v);
      } else if (mod && e.key === ",") {
        e.preventDefault(); setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo, canUndo, canRedo]);

  const showCompare = comparisonMode && !!originalSubtitles;

  return (
    <div
      data-th={darkMode ? "dark" : "light"}
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--c-bg)",
        color: "var(--c-text)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <TitleBar onOpenSettings={() => setSettingsOpen(true)} onOpenShortcuts={() => setShortcutsOpen(true)} />
      <Banner />

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <Rail mode={mode} setMode={setMode} onOpenExportPreview={() => setExportPreviewOpen(true)} />

        {mode === "media" ? (
          <OpenView onOpenMedia={handleOpenMedia} onImportSrt={handleImportSrt} onOpenRecent={handleOpenRecent} />
        ) : (
          <>
            <SubtitleEditor />

            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
              {showCompare ? <CompareView /> : <Player />}
            </div>

            <div
              style={{
                width: 328,
                flex: "none",
                background: "var(--c-panel)",
                borderLeft: "1px solid var(--c-border)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              {/* All panels stay mounted so in-flight progress survives mode switches. */}
              <div style={{ display: mode === "transcribe" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
                <TranscriptionPanel audioPath={audioPath} extracting={extracting} onCancelExtraction={handleCancelExtraction} />
              </div>
              <div style={{ display: mode === "translate" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
                <TranslationPanel />
              </div>
              <div style={{ display: mode === "style" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
                <StylePanel />
              </div>
              <div style={{ display: mode === "history" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
                <HistoryPanel />
              </div>
            </div>
          </>
        )}
      </div>

      <LogPanel />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ExportPreviewModal open={exportPreviewOpen} onClose={() => setExportPreviewOpen(false)} />
      {!onboardingCompleted && <OnboardingWizard />}

      {isDragging && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 300,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(37,99,255,.10)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              padding: "30px 44px",
              borderRadius: 14,
              border: `2px dashed ${COLORS.blue}`,
              background: "var(--c-panel)",
            }}
          >
            <Upload size={30} color={COLORS.blue} />
            <span style={f(600, 15, "display")}>{t("common:dropFileToOpen")}</span>
            <span style={f(400, 11, "body", { color: "var(--c-muted)" })}>{t("common:dropFileHint")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
