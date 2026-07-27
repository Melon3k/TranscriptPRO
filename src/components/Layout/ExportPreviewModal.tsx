import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ModalHeader } from "../KeyboardShortcutsModal";
import { COLORS, f, FONTS, scrim, modalCard, tabStyle, primaryBtn } from "../../lib/ui";
import {
  saveSrtFileDialog,
  saveVttFileDialog,
  exportSrt,
  exportVtt,
  previewExport,
  type PreviewFormat,
} from "../../lib/tauri-commands";
import { hasInvertedTiming } from "../../lib/subtitle-ops";
import { formatError } from "../../lib/error-format";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useNotifyStore } from "../../stores/notifyStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ExportPreviewModal({ open, onClose }: Props) {
  const { t } = useTranslation(["toolbar", "errors"]);
  const subtitles = useSubtitleStore((s) => s.subtitles);
  const markSaved = useSubtitleStore((s) => s.markSaved);
  const notify = useNotifyStore((s) => s.notify);

  const [tab, setTab] = useState<PreviewFormat>("srt");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (open) setTab("srt");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    previewExport(subtitles, tab)
      .then((out) => {
        if (!cancelled) {
          setText(out);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          notify("error", formatError(t, e));
          onClose();
        }
      });
    return () => {
      cancelled = true;
    };
    // subtitles IS a dep: a background store update (in-flight translation
    // completing, autosave, version restore) must re-run the preview so the
    // <pre> can never drift from what download() writes from the live store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, subtitles]);

  if (!open) return null;

  const inverted = subtitles.filter(hasInvertedTiming);

  async function download() {
    // No native ask() here: unlike the one-click menu exports, this modal already
    // surfaces the inverted-timings warning as a red banner directly above the
    // Download button (see below), so the modal itself is the confirmation surface
    // — a second blocking dialog would be a double prompt for the same condition.
    setDownloading(true);
    try {
      const path = tab === "srt" ? await saveSrtFileDialog() : await saveVttFileDialog();
      if (path) {
        if (tab === "srt") await exportSrt(path, subtitles);
        else await exportVtt(path, subtitles);
        // Only SRT is the canonical project-save; VTT is a working export we
        // can't re-import, so it must not clear the unsaved-changes guard.
        if (tab === "srt") markSaved();
        notify("success", t("toolbar:exportSuccess", { name: path.split(/[/\\]/).pop() ?? path }));
        onClose();
      }
    } catch (e) {
      notify("error", formatError(t, e));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div style={scrim} onClick={onClose}>
      <div style={modalCard(600)} onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<FileText size={17} color={COLORS.blueLight} />}
          title={t("toolbar:exportPreviewTitle")}
          onClose={onClose}
        />
        <div style={{ display: "flex", borderBottom: "1px solid var(--c-border)" }}>
          <button onClick={() => setTab("srt")} style={{ ...tabStyle(tab === "srt"), background: "none", border: "none", borderBottom: tabStyle(tab === "srt").borderBottom }}>
            SRT
          </button>
          <button onClick={() => setTab("vtt")} style={{ ...tabStyle(tab === "vtt"), background: "none", border: "none", borderBottom: tabStyle(tab === "vtt").borderBottom }}>
            VTT
          </button>
        </div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          {inverted.length > 0 && (
            <div
              style={{
                border: `1px solid ${COLORS.red}`,
                borderRadius: 8,
                background: "rgba(240,67,91,.08)",
                padding: "10px 12px",
                color: COLORS.red,
                ...f(500, 11),
              }}
            >
              {t("toolbar:invertedWarnInline", { count: inverted.length, first: inverted[0].index })}
            </div>
          )}
          <pre
            style={{
              fontFamily: FONTS.mono,
              fontSize: 11,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
              padding: 12,
              background: "var(--c-input)",
              border: "1px solid var(--c-border)",
              borderRadius: 8,
              maxHeight: "46vh",
              overflow: "auto",
              color: "var(--c-text2)",
            }}
          >
            {loading ? t("toolbar:exportPreviewLoading") : text === "" ? t("toolbar:exportPreviewEmpty") : text}
          </pre>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 18px", borderTop: "1px solid var(--c-border)" }}>
          <button
            onClick={download}
            disabled={downloading || loading}
            style={{ ...primaryBtn(COLORS.blue, downloading || loading), width: "auto", padding: "0 18px" }}
          >
            {t("toolbar:exportPreviewDownload")}
          </button>
        </div>
      </div>
    </div>
  );
}
