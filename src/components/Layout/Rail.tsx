import { useEffect, useRef, useState } from "react";
import {
  Film,
  Mic,
  Captions,
  Languages,
  Clock,
  Download,
  Terminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useLogStore } from "../../stores/logStore";
import { useNotifyStore } from "../../stores/notifyStore";
import { useStyleStore } from "../../stores/styleStore";
import { usePlayerStore } from "../../stores/playerStore";
import {
  saveSrtFileDialog,
  saveTxtFileDialog,
  saveAssFileDialog,
  saveMp4FileDialog,
  exportWordSrt,
  exportTxt,
  exportAss,
} from "../../lib/tauri-commands";
import { ask } from "@tauri-apps/plugin-dialog";
import { hasInvertedTiming } from "../../lib/subtitle-ops";
import { formatError } from "../../lib/error-format";
import { APPROXIMATE_ANIMATIONS } from "../../types/captionStyle";
import { navStyle, f } from "../../lib/ui";
import type { AppMode } from "./modes";

interface RailProps {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  onOpenExportPreview: () => void;
  onStartVideoExport: (outputPath: string) => void;
}

/** Left navigation rail: workspace switcher + export menu + logs toggle. */
export default function Rail({ mode, setMode, onOpenExportPreview, onStartVideoExport }: RailProps) {
  const { t } = useTranslation(["toolbar", "common"]);
  const logsOpen = useLogStore((s) => s.open);
  const toggleLogs = useLogStore((s) => s.togglePanel);

  const navItems: { key: AppMode; icon: React.ReactNode; label: string }[] = [
    { key: "media", icon: <Film size={19} />, label: t("toolbar:openMedia") },
    { key: "transcribe", icon: <Mic size={19} />, label: t("common:transcribe") },
    { key: "style", icon: <Captions size={19} />, label: t("toolbar:style") },
    { key: "translate", icon: <Languages size={19} />, label: t("common:translate") },
    { key: "history", icon: <Clock size={19} />, label: t("common:history") },
  ];

  return (
    <div
      style={{
        width: 62,
        flex: "none",
        background: "var(--c-rail)",
        borderRight: "1px solid var(--c-border)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
        padding: "12px 0",
      }}
    >
      {navItems.map((item) => (
        <button
          key={item.key}
          onClick={() => setMode(item.key)}
          title={item.label}
          style={{ ...navStyle(mode === item.key), background: navStyle(mode === item.key).background, border: "none" }}
        >
          {item.icon}
        </button>
      ))}

      <div style={{ flex: 1 }} />

      <ExportMenu onOpenExportPreview={onOpenExportPreview} onStartVideoExport={onStartVideoExport} />

      <button
        onClick={toggleLogs}
        title={logsOpen ? t("toolbar:hideLogs") : t("toolbar:showLogs")}
        style={{ ...navStyle(logsOpen), border: "none" }}
      >
        <Terminal size={19} />
      </button>
    </div>
  );
}

// ── Export menu ───────────────────────────────────────────────────────────────

function filename(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

// Burn-in needs an actual video track; an audio-only project (filePath set to a
// .mp3/.wav) has nothing to render subtitles onto, so gate on the extension.
const VIDEO_EXT = /\.(mp4|mkv|avi|mov|webm|m4v)$/i;

function ExportMenu({
  onOpenExportPreview,
  onStartVideoExport,
}: {
  onOpenExportPreview: () => void;
  onStartVideoExport: (outputPath: string) => void;
}) {
  const { t } = useTranslation(["toolbar", "errors"]);
  const subtitles = useSubtitleStore((s) => s.subtitles);
  const markSaved = useSubtitleStore((s) => s.markSaved);
  const notify = useNotifyStore((s) => s.notify);
  const filePath = usePlayerStore((s) => s.filePath);
  const videoLoaded = !!filePath && VIDEO_EXT.test(filePath);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const disabled = subtitles.length === 0;

  // MP4 burn-in additionally requires a loaded video. Opens a save dialog, then
  // hands the chosen path to the VideoExportModal (which reads style/animation
  // and runs the ffmpeg job); it does NOT go through run() — burning in is not
  // a project-save.
  async function startVideoExport() {
    setOpen(false);
    try {
      const base = (filePath!.split(/[/\\]/).pop() ?? "video").replace(/\.[^.]+$/, "");
      const out = await saveMp4FileDialog(`${base}.mp4`);
      if (out) onStartVideoExport(out);
    } catch (e) {
      notify("error", formatError(t, e));
    }
  }

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // `faithful` formats round-trip the full editing state, so a successful export
  // clears the unsaved-changes guard; TXT and Word SRT are lossy and must not.
  // `timed` formats carry timings, so inverted cues (start >= end) would ship
  // broken — in-editor editing deliberately allows the transient inversion, this
  // dialog is the backstop that keeps it from leaving the app silently.
  async function run(
    handler: () => Promise<string | null>,
    faithful: boolean,
    timed: boolean,
    warn?: () => string | null,
  ) {
    setOpen(false);
    if (timed) {
      const inverted = subtitles.filter(hasInvertedTiming);
      if (inverted.length > 0) {
        const proceed = await ask(
          t("toolbar:invertedTimings", {
            count: inverted.length,
            first: inverted[0].index,
          }),
          { title: t("toolbar:invertedTimingsTitle"), kind: "warning" },
        );
        if (!proceed) return;
      }
    }
    try {
      const savedPath = await handler();
      if (savedPath) {
        if (faithful) markSaved();
        const success = t("toolbar:exportSuccess", { name: filename(savedPath) });
        // notifyStore holds a single banner (last write wins), so a warning
        // can't be a second notify — it would clobber, or be clobbered by, the
        // success banner. Fold it into one info banner that both confirms the
        // export and carries the caveat.
        const warning = warn?.();
        if (warning) {
          notify("info", `${success} — ${warning}`);
        } else {
          notify("success", success);
        }
      }
    } catch (e) {
      notify("error", formatError(t, e));
    }
  }

  const items: {
    label: string;
    hint: string;
    faithful: boolean;
    timed: boolean;
    handler: () => Promise<string | null>;
    warn?: () => string | null;
  }[] = [
    {
      label: "Word SRT", hint: t("toolbar:exportKaraoke"), faithful: false, timed: true,
      handler: async () => { const p = await saveSrtFileDialog("subtitles-words.srt"); if (p) await exportWordSrt(p, subtitles); return p; },
    },
    {
      label: "ASS", hint: "SubStation", faithful: true, timed: true,
      handler: async () => {
        const p = await saveAssFileDialog();
        if (p) {
          // Read at click time — subscribing would re-render the Rail on every
          // style/animation tweak (same reasoning as the style read).
          const { style, animation } = useStyleStore.getState();
          await exportAss(p, subtitles, style, animation);
        }
        return p;
      },
      // Every type is baked into the .ass now, but the \t-based entrances
      // (slide/pop/typewriter/blur) are only approximate — linear, no per-word
      // stagger. Notify for those. run() folds this into the success banner (a
      // bare notify here would be overwritten by the success banner —
      // single-slot notifyStore).
      warn: () => {
        const { animation } = useStyleStore.getState();
        return APPROXIMATE_ANIMATIONS.has(animation.type)
          ? t("toolbar:animationPreviewOnly")
          : null;
      },
    },
    {
      label: "TXT", hint: t("toolbar:exportText"), faithful: false, timed: false,
      handler: async () => { const p = await saveTxtFileDialog(); if (p) await exportTxt(p, subtitles); return p; },
    },
  ];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={t("toolbar:export")}
        style={{ ...navStyle(open, disabled), border: "none" }}
      >
        <Download size={19} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            left: 52,
            bottom: 0,
            width: 200,
            background: "var(--c-panel)",
            border: "1px solid var(--c-border)",
            borderRadius: 10,
            boxShadow: "0 16px 40px rgba(0,0,0,.45)",
            padding: 6,
            zIndex: 30,
          }}
        >
          <div style={{ ...f(600, 9), letterSpacing: ".1em", color: "var(--c-muted)", padding: "4px 10px 6px" }}>
            {t("toolbar:export").toUpperCase()}
          </div>
          <button
            onClick={() => { setOpen(false); onOpenExportPreview(); }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              height: 32,
              padding: "0 10px",
              borderRadius: 7,
              cursor: "pointer",
              background: "none",
              border: "none",
              color: "var(--c-text)",
              ...f(600, 11),
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--c-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          >
            {t("toolbar:exportPreviewEntry")}
            <span style={{ ...f(400, 9), color: "var(--c-muted)" }}>{t("toolbar:exportPreviewFormats")}</span>
          </button>
          <button
            onClick={() => videoLoaded && void startVideoExport()}
            disabled={!videoLoaded}
            title={videoLoaded ? undefined : t("toolbar:exportVideoDisabledNoVideo")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              height: 32,
              padding: "0 10px",
              borderRadius: 7,
              cursor: videoLoaded ? "pointer" : "not-allowed",
              background: "none",
              border: "none",
              color: videoLoaded ? "var(--c-text)" : "var(--c-muted)",
              ...f(600, 11),
            }}
            onMouseEnter={(e) => videoLoaded && (e.currentTarget.style.background = "var(--c-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          >
            {t("toolbar:exportVideo")}
            <span style={{ ...f(400, 9), color: "var(--c-muted)" }}>{t("toolbar:exportVideoHint")}</span>
          </button>
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => run(item.handler, item.faithful, item.timed, item.warn)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                height: 32,
                padding: "0 10px",
                borderRadius: 7,
                cursor: "pointer",
                background: "none",
                border: "none",
                color: "var(--c-text)",
                ...f(600, 11),
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--c-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              {item.label}
              <span style={{ ...f(400, 9), color: "var(--c-muted)" }}>{item.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
