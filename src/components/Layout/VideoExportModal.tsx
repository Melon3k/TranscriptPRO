import { useEffect, useRef, useState } from "react";
import { Clapperboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ModalHeader } from "../KeyboardShortcutsModal";
import { COLORS, f, scrim, modalCard } from "../../lib/ui";
import { exportVideo, cancelVideoExport } from "../../lib/tauri-commands";
import { formatError, isCancellation } from "../../lib/error-format";
import { usePlayerStore } from "../../stores/playerStore";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useStyleStore } from "../../stores/styleStore";
import { useNotifyStore } from "../../stores/notifyStore";

interface Props {
  outputPath: string | null;
  onClose: () => void;
}

export default function VideoExportModal({ outputPath, onClose }: Props) {
  const { t } = useTranslation(["toolbar", "errors", "common"]);
  const notify = useNotifyStore((s) => s.notify);

  const [progress, setProgress] = useState(0);
  const [cancelling, setCancelling] = useState(false);

  // Guards a late Channel message (or resolve/reject) after the modal closed
  // from setting state on an unmounted component.
  const alive = useRef(false);

  useEffect(() => {
    if (outputPath === null) return;
    alive.current = true;
    setProgress(0);
    setCancelling(false);

    // Snapshot inputs WITHOUT subscribing — reading via getState() keeps the
    // Rail/panels from re-rendering on every style tweak (matches the ASS export).
    const { filePath } = usePlayerStore.getState();
    if (!filePath) {
      notify("error", t("toolbar:exportVideoDisabledNoVideo"));
      onClose();
      return;
    }
    const subtitles = useSubtitleStore.getState().subtitles;
    const { style, animation } = useStyleStore.getState();

    exportVideo(filePath, subtitles, style, animation, outputPath, (p) => {
      if (alive.current) setProgress(p);
    })
      .then(() => {
        // Burning in is not a project-save, so we do NOT markSaved().
        notify(
          "success",
          t("toolbar:videoExportSuccess", { name: outputPath.split(/[/\\]/).pop() ?? outputPath }),
        );
      })
      .catch((e) => {
        // User-initiated cancel closes quietly — no error banner.
        if (!isCancellation(e)) notify("error", formatError(t, e));
      })
      .finally(() => {
        onClose();
      });

    return () => {
      alive.current = false;
    };
    // outputPath is the trigger; the callbacks read live state via getState().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputPath]);

  if (outputPath === null) return null;

  const pct = Math.round(progress * 100);

  async function onCancel() {
    setCancelling(true);
    try {
      await cancelVideoExport();
    } catch {
      // Ignore — the export promise's reject path (or resolve) drives onClose;
      // a failed cancel just means it finished on its own.
    }
  }

  return (
    // No-op scrim click: cancellation must route through cancelVideoExport so
    // Rust can kill ffmpeg and clean up the temp .ass and .part files.
    <div style={scrim} onClick={(e) => e.stopPropagation()}>
      <div style={modalCard(420)} onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<Clapperboard size={17} color={COLORS.blueLight} />}
          title={t("toolbar:videoExportTitle")}
          onClose={onCancel}
        />
        <div style={{ padding: "18px 18px 8px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={f(600, 12, "body", { color: "var(--c-text)" })}>
              {t("toolbar:videoExportProgress")}
            </span>
            <span style={f(600, 12, "mono", { color: "var(--c-text2)" })}>{pct}%</span>
          </div>
          <div
            style={{
              height: 8,
              borderRadius: 999,
              background: "var(--c-input)",
              border: "1px solid var(--c-border)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background: COLORS.blue,
                borderRadius: 999,
                transition: "width .15s",
              }}
            />
          </div>
          <span style={f(400, 10, "body", { color: "var(--c-muted)", lineHeight: 1.5 })}>
            {t("toolbar:videoExportFontNote")}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 18px", borderTop: "1px solid var(--c-border)" }}>
          <button
            onClick={onCancel}
            disabled={cancelling}
            style={{
              height: 34,
              padding: "0 16px",
              background: "var(--c-raised)",
              border: "1px solid var(--c-border)",
              borderRadius: 8,
              cursor: cancelling ? "not-allowed" : "pointer",
              opacity: cancelling ? 0.5 : 1,
              ...f(600, 12, "body", { color: "var(--c-text)" }),
            }}
          >
            {t("toolbar:videoExportCancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
