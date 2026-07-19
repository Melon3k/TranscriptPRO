import { useRef, useEffect, useCallback, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Film, Captions, CaptionsOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useStyleStore } from "../../stores/styleStore";
import { formatDuration } from "../../lib/time-format";
import { captionBoxCss, captionTextCss } from "../../lib/caption-style";
import { COLORS, FONTS } from "../../lib/ui";

/**
 * Center video/audio stage. Renders the media, an optional subtitle overlay
 * (toggled from the corner button, only when subtitles exist), and the
 * transport controls.
 */
export default function Player() {
  const { t } = useTranslation(["player"]);
  const { filePath, currentTimeMs, duration, isPlaying, setCurrentTimeMs, setDuration, setIsPlaying } =
    usePlayerStore();
  const subtitles = useSubtitleStore((s) => s.subtitles);
  const style = useStyleStore((s) => s.style);
  const [showSubs, setShowSubs] = useState(false);
  const hasSubtitles = subtitles.length > 0;

  const mediaRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Rendered video content box inside the stage. Captions anchor to THIS
  // rect, not the stage, so letterbox/pillarbox bars don't skew size or
  // position vs. the ASS export (which is defined relative to the frame).
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);

  const measureFrame = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const v = mediaRef.current;
    if (v && v.videoWidth > 0 && v.videoHeight > 0) {
      // Mirrors the video's maxWidth/maxHeight:100% sizing (no upscale).
      const scale = Math.min(sw / v.videoWidth, sh / v.videoHeight, 1);
      setFrame({ w: v.videoWidth * scale, h: v.videoHeight * scale });
    } else {
      setFrame({ w: sw, h: sh });
    }
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(measureFrame);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [measureFrame]);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (Math.abs(el.currentTime * 1000 - currentTimeMs) > 200) {
      el.currentTime = currentTimeMs / 1000;
    }
  }, [currentTimeMs]);

  const handleTimeUpdate = useCallback(() => {
    const el = mediaRef.current;
    if (el) setCurrentTimeMs(el.currentTime * 1000);
  }, [setCurrentTimeMs]);

  const handleLoadedMetadata = useCallback(() => {
    const el = mediaRef.current;
    if (el) setDuration(el.duration);
    measureFrame(); // videoWidth/videoHeight are only known from here on
  }, [setDuration, measureFrame]);

  const togglePlay = () => {
    const el = mediaRef.current;
    if (!el || !filePath) return;
    if (el.paused) { el.play(); setIsPlaying(true); }
    else { el.pause(); setIsPlaying(false); }
  };

  const skip = (deltaMs: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, el.currentTime + deltaMs / 1000);
  };

  const handleProgressClick = (e: React.MouseEvent) => {
    const el = mediaRef.current;
    const bar = progressRef.current;
    if (!el || !bar) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * el.duration;
  };

  const progressPercent = duration > 0 ? (currentTimeMs / 1000 / duration) * 100 : 0;
  const mediaSrc = filePath ? convertFileSrc(filePath) : undefined;

  const activeSub = subtitles.find((s) => currentTimeMs >= s.startTime && currentTimeMs < s.endTime);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* stage */}
      <div
        ref={stageRef}
        style={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          background: "#000",
          margin: 16,
          borderRadius: 10,
          border: "1px solid var(--c-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {mediaSrc ? (
          <video
            ref={mediaRef}
            src={mediaSrc}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onEnded={() => setIsPlaying(false)}
            preload="metadata"
            style={{ maxWidth: "100%", maxHeight: "100%", background: "#000" }}
          />
        ) : (
          <>
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "repeating-linear-gradient(45deg,#0e131c,#0e131c 14px,#0c1017 14px,#0c1017 28px)",
              }}
            />
            <Film size={60} color="#1c2431" style={{ position: "relative" }} />
          </>
        )}

        {/* Subtitle overlay — only rendered while enabled and a cue is active.
            No background pill: the box isn't part of the style model and the
            preview must stay honest vs. the ASS export (F2). */}
        {showSubs && activeSub && frame && (
          // Wrapper matching the rendered video frame (videos center in the
          // stage), so captionBoxCss percentages resolve against the frame.
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%,-50%)",
              width: frame.w,
              height: frame.h,
              pointerEvents: "none",
            }}
          >
            <div style={captionBoxCss(style)}>
              <span
                style={{
                  ...captionTextCss(style),
                  // fontSize is defined at a 1080-px-tall reference canvas;
                  // scale it by the measured frame height (px, not cqh —
                  // WKWebView on macOS 10.15 lacks container-query units).
                  fontSize: `${((style.fontSize / 1080) * frame.h).toFixed(2)}px`,
                }}
              >
                {activeSub.text}
              </span>
            </div>
          </div>
        )}

        {/* Corner toggle — enabled only when there are subtitles to show. */}
        {hasSubtitles && (
          <button
            onClick={() => setShowSubs((v) => !v)}
            title={showSubs ? t("player:hideSubtitles") : t("player:showSubtitles")}
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              cursor: "pointer",
              background: showSubs ? COLORS.blue : "rgba(8,12,18,.6)",
              border: `1px solid ${showSubs ? COLORS.blue : "var(--c-border)"}`,
              color: "#fff",
            }}
          >
            {showSubs ? <Captions size={16} /> : <CaptionsOff size={16} />}
          </button>
        )}
      </div>

      {/* transport */}
      <div style={{ height: 46, flex: "none", display: "flex", alignItems: "center", gap: 14, padding: "0 20px 12px" }}>
        <button onClick={() => skip(-5000)} disabled={!filePath} title={t("player:back5s")} style={ctrlIcon(!filePath)}>
          <SkipBack size={15} />
        </button>
        <button
          onClick={togglePlay}
          disabled={!filePath}
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: filePath ? COLORS.blue : "var(--c-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: filePath ? "pointer" : "not-allowed",
            border: "none",
            color: "#fff",
          }}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} style={{ marginLeft: 1 }} />}
        </button>
        <button onClick={() => skip(5000)} disabled={!filePath} title={t("player:forward5s")} style={ctrlIcon(!filePath)}>
          <SkipForward size={15} />
        </button>
        <div
          ref={progressRef}
          onClick={handleProgressClick}
          style={{ flex: 1, height: 5, borderRadius: 3, background: "var(--c-border)", position: "relative", cursor: "pointer" }}
        >
          <span
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${progressPercent}%`,
              background: COLORS.blue,
              borderRadius: 3,
            }}
          />
        </div>
        <span style={{ fontFamily: FONTS.mono, fontWeight: 600, fontSize: 11, color: "var(--c-text2)" }}>
          {formatDuration(currentTimeMs / 1000)} / {formatDuration(duration)}
        </span>
      </div>
    </div>
  );
}

function ctrlIcon(disabled: boolean): React.CSSProperties {
  return {
    background: "none",
    border: "none",
    color: "var(--c-text2)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.3 : 1,
    display: "flex",
    padding: 0,
  };
}
