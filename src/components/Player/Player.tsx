import { useRef, useEffect, useCallback, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Film, Captions, CaptionsOff, Move } from "lucide-react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useStyleStore } from "../../stores/styleStore";
import { formatDuration } from "../../lib/time-format";
import { captionBoxCss, captionTextCss, pointerToBoxPlacement, pointerToWidthPct } from "../../lib/caption-style";
import { karaokeSegments } from "../../lib/caption-animation";
import { COLORS, FONTS } from "../../lib/ui";
import type { CaptionAnimation, CaptionStyle } from "../../types/captionStyle";
import type { Subtitle } from "../../types/subtitle";

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
  const animation = useStyleStore((s) => s.animation);
  const setStyle = useStyleStore((s) => s.setStyle);
  const [showSubs, setShowSubs] = useState(false);
  const [positioning, setPositioning] = useState(false);
  // Set during an active "move" drag so the snap guides re-render; the drag
  // gesture itself is tracked on dragRef (no re-render needed for it).
  const [showGuides, setShowGuides] = useState(false);
  const hasSubtitles = subtitles.length > 0;

  const mediaRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Frame-sized wrapper — drag math reads its rect to derive pointer ratios.
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<null | "move" | "resize">(null);
  const rafRef = useRef<number | null>(null);
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

  // When subtitles disappear the corner toggles unmount, so exit positioning
  // (and hide the overlay) — otherwise the sample box stays on screen with no
  // control to dismiss it.
  useEffect(() => {
    if (!hasSubtitles) {
      setPositioning(false);
      setShowSubs(false);
    }
  }, [hasSubtitles]);

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

  const ratiosFromEvent = useCallback((e: React.PointerEvent) => {
    const r = frameRef.current!.getBoundingClientRect();
    return { rx: (e.clientX - r.left) / r.width, ry: (e.clientY - r.top) / r.height };
  }, []);

  const endDrag = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    setShowGuides(false);
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    // On pointercancel the capture is already implicitly dropped, so guard the
    // release to avoid a NotFoundError.
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const onBoxPointerDown = useCallback((e: React.PointerEvent) => {
    if (!positioning) return;
    e.preventDefault();
    dragRef.current = "move";
    setShowGuides(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [positioning]);

  const onBoxPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragRef.current !== "move" || !frameRef.current) return;
    const { rx, ry } = ratiosFromEvent(e);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    // Read the freshest style inside the rAF so successive drags compose off
    // committed state, not a stale render-time closure (mirrors the Inspector).
    rafRef.current = requestAnimationFrame(() => {
      setStyle(pointerToBoxPlacement(rx, ry, useStyleStore.getState().style));
    });
  }, [ratiosFromEvent, setStyle]);

  const onHandlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = "resize";
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onHandlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragRef.current !== "resize" || !frameRef.current) return;
    const { rx } = ratiosFromEvent(e);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setStyle({ widthPct: pointerToWidthPct(rx, useStyleStore.getState().style) });
    });
  }, [ratiosFromEvent, setStyle]);

  const col = (style.boxPosition - 1) % 3;
  const boxStyle: React.CSSProperties = {
    ...captionBoxCss(style),
    ...(positioning
      ? {
          pointerEvents: "auto" as const,
          cursor: "move",
          outline: `1px dashed ${COLORS.blue}`,
          outlineOffset: 4,
          borderRadius: 4,
          // Pin the box to the full widthPct so the resize handle sits on the
          // real width boundary (not the shrink-to-fit sample-text edge) and
          // dragging gives visible feedback that matches the persisted width.
          width: `${style.widthPct}%`,
        }
      : null),
  };

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
        {showSubs && frame && (activeSub || positioning) && (
          // Wrapper matching the rendered video frame (videos center in the
          // stage), so captionBoxCss percentages resolve against the frame.
          <div
            ref={frameRef}
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
            {showGuides && (
              // Column/row snap hints (33%/66%) shown only during a move drag.
              <>
                {[1 / 3, 2 / 3].map((f) => (
                  <span
                    key={`v${f}`}
                    style={{ position: "absolute", top: 0, bottom: 0, left: `${f * 100}%`, width: 1, background: `${COLORS.blue}33` }}
                  />
                ))}
                {[1 / 3, 2 / 3].map((f) => (
                  <span
                    key={`h${f}`}
                    style={{ position: "absolute", left: 0, right: 0, top: `${f * 100}%`, height: 1, background: `${COLORS.blue}33` }}
                  />
                ))}
              </>
            )}
            <div
              style={boxStyle}
              title={positioning ? t("player:moveCaption") : undefined}
              aria-label={positioning ? t("player:moveCaption") : undefined}
              onPointerDown={positioning ? onBoxPointerDown : undefined}
              onPointerMove={positioning ? onBoxPointerMove : undefined}
              onPointerUp={positioning ? endDrag : undefined}
              onPointerCancel={positioning ? endDrag : undefined}
            >
              <AnimatedCaption
                // Key by cue id so CSS entrance animations restart each cue
                // (a new element mounts). Undefined key (sample text) is stable.
                key={activeSub?.id}
                style={style}
                animation={animation}
                sub={activeSub ?? null}
                nowMs={currentTimeMs}
                frameH={frame.h}
              />
              {positioning && (
                <span
                  onPointerDown={onHandlePointerDown}
                  onPointerMove={onHandlePointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  title={t("player:resizeWidth")}
                  aria-label={t("player:resizeWidth")}
                  style={{
                    position: "absolute",
                    top: "50%",
                    transform: "translateY(-50%)",
                    ...(col === 2 ? { left: -5 } : { right: -5 }),
                    width: 10,
                    height: 22,
                    borderRadius: 3,
                    background: COLORS.blue,
                    cursor: "ew-resize",
                    pointerEvents: "auto",
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* Corner toggles — enabled only when there are subtitles to show. */}
        {hasSubtitles && (
          <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6 }}>
            <button
              onClick={() => { setShowSubs(true); setPositioning((p) => !p); }}
              title={positioning ? t("player:exitEditPosition") : t("player:editPosition")}
              aria-label={positioning ? t("player:exitEditPosition") : t("player:editPosition")}
              style={cornerBtn(positioning)}
            >
              <Move size={16} />
            </button>
            <button
              onClick={() => { if (showSubs) setPositioning(false); setShowSubs(!showSubs); }}
              title={showSubs ? t("player:hideSubtitles") : t("player:showSubtitles")}
              style={cornerBtn(showSubs)}
            >
              {showSubs ? <Captions size={16} /> : <CaptionsOff size={16} />}
            </button>
          </div>
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

// slide/pop/blur map to a one-shot entrance keyframe; fade/typewriter/karaoke
// are JS-driven off nowMs so they track scrubbing, not just mount.
const ENTRANCE_KEYFRAME: Record<"slide" | "pop" | "blur", string> = {
  slide: "captionSlideUp",
  pop: "captionPop",
  blur: "captionBlurIn",
};

/** Animation-aware caption span. Honestly previews what fade/karaoke export
 *  and animates the four preview-only types; `sub === null` is the positioning
 *  sample, which renders plain (animation ignored). Mounted with a cue-id key
 *  so entrance keyframes restart per cue. */
function AnimatedCaption({
  style,
  animation,
  sub,
  nowMs,
  frameH,
}: {
  style: CaptionStyle;
  animation: CaptionAnimation;
  sub: Subtitle | null;
  nowMs: number;
  frameH: number;
}) {
  const { t } = useTranslation(["player"]);
  const base: React.CSSProperties = {
    ...captionTextCss(style),
    // fontSize is defined at a 1080-px-tall reference canvas; scale it by the
    // measured frame height (px, not cqh — WKWebView on macOS 10.15 lacks
    // container-query units).
    fontSize: `${((style.fontSize / 1080) * frameH).toFixed(2)}px`,
  };

  // Positioning sample: no cue → plain text, no animation.
  if (!sub) {
    return <span style={base}>{t("player:positionSample")}</span>;
  }

  const type = animation.type;

  if (type === "fade") {
    // Fade-out overrides the mount fade-in near the cue end. Linear both ways
    // to match the exported ASS \fad (which is linear).
    const remaining = sub.endTime - nowMs;
    const fadingOut = remaining < animation.durationMs;
    const spanStyle: React.CSSProperties = fadingOut
      ? { ...base, opacity: Math.max(0, remaining / animation.durationMs) }
      : { ...base, animation: `captionFadeIn ${animation.durationMs}ms linear both` };
    return <span style={spanStyle}>{sub.text}</span>;
  }

  if (type === "slide" || type === "pop" || type === "blur") {
    return (
      <span
        style={{
          ...base,
          animation: `${ENTRANCE_KEYFRAME[type]} ${animation.durationMs}ms ${animation.easing} both`,
        }}
      >
        {sub.text}
      </span>
    );
  }

  if (type === "typewriter") {
    // Reveal by elapsed fraction of durationMs; slice avoids ch-unit reliance.
    const chars = Math.round(
      ((nowMs - sub.startTime) / Math.max(animation.durationMs, 1)) * sub.text.length,
    );
    return <span style={base}>{sub.text.slice(0, Math.max(0, chars))}</span>;
  }

  if (type === "karaoke") {
    // Per-word spans override only color; the wrapper keeps the single
    // captionTextCss textShadow (don't stack it per span).
    return (
      <span style={base}>
        {karaokeSegments(sub, nowMs).map((seg, i) => (
          <span key={i} style={{ color: seg.sung ? animation.highlightColor : style.textColor }}>
            {seg.text}
          </span>
        ))}
      </span>
    );
  }

  // "none"
  return <span style={base}>{sub.text}</span>;
}

function cornerBtn(active: boolean): React.CSSProperties {
  return {
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    cursor: "pointer",
    background: active ? COLORS.blue : "rgba(8,12,18,.6)",
    border: `1px solid ${active ? COLORS.blue : "var(--c-border)"}`,
    color: "#fff",
  };
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
