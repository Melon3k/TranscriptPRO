import { useRef, useEffect, useCallback, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Film, Captions, CaptionsOff, Move } from "lucide-react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { usePlayerStore } from "../../stores/playerStore";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { useStyleStore } from "../../stores/styleStore";
import { formatDuration } from "../../lib/time-format";
import { captionBoxCss, captionTextCss, hexToCssColor, pointerToBoxPlacement, pointerToWidthPct } from "../../lib/caption-style";
import { karaokeSegments } from "../../lib/caption-animation";
import { COLORS, FONTS } from "../../lib/ui";
import type {
  AnimationGranularity,
  CaptionAnimation,
  CaptionStyle,
} from "../../types/captionStyle";
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
  // Smoothed playhead for the caption overlay ONLY. The media element's
  // `timeupdate` fires ~4Hz on WKWebView, which makes the playhead-driven
  // caption animations (fade / typewriter / karaoke) step visibly. A rAF loop
  // samples the media clock at ~60fps while playing so they ramp smoothly.
  // Kept Player-local (not pushed into the store) so the segment list — which
  // derives its active-row highlight from the store — does not re-render 60×/s.
  const [smoothMs, setSmoothMs] = useState(0);
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
    if (el) {
      setCurrentTimeMs(el.currentTime * 1000);
      setSmoothMs(el.currentTime * 1000); // keep the overlay clock fresh when paused/seeking
    }
  }, [setCurrentTimeMs]);

  // ~60fps caption clock while playing (see smoothMs). Cancels on pause/unmount.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const el = mediaRef.current;
      if (el) setSmoothMs(el.currentTime * 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

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

  // Overlay uses the smooth clock while playing; the store value (4Hz, fresh on
  // seek/pause) is authoritative otherwise. Both agree to within one frame.
  const overlayMs = isPlaying ? smoothMs : currentTimeMs;
  const activeSub = subtitles.find((s) => overlayMs >= s.startTime && overlayMs < s.endTime);

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
              data-tip={positioning ? t("player:moveCaption") : undefined}
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
                nowMs={overlayMs}
                frameH={frame.h}
              />
              {positioning && (
                <span
                  onPointerDown={onHandlePointerDown}
                  onPointerMove={onHandlePointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  data-tip={t("player:resizeWidth")}
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
              data-tip={positioning ? t("player:exitEditPosition") : t("player:editPosition")}
              aria-label={positioning ? t("player:exitEditPosition") : t("player:editPosition")}
              style={cornerBtn(positioning)}
            >
              <Move size={16} />
            </button>
            <button
              onClick={() => { if (showSubs) setPositioning(false); setShowSubs(!showSubs); }}
              data-tip={showSubs ? t("player:hideSubtitles") : t("player:showSubtitles")}
              aria-label={showSubs ? t("player:hideSubtitles") : t("player:showSubtitles")}
              style={cornerBtn(showSubs)}
            >
              {showSubs ? <Captions size={16} /> : <CaptionsOff size={16} />}
            </button>
          </div>
        )}
      </div>

      {/* transport */}
      <div style={{ height: 46, flex: "none", display: "flex", alignItems: "center", gap: 14, padding: "0 20px 12px" }}>
        <button onClick={() => skip(-5000)} disabled={!filePath} aria-label={t("player:back5s")} data-tip={t("player:back5s")} style={ctrlIcon(!filePath)}>
          <SkipBack size={15} />
        </button>
        <button
          onClick={togglePlay}
          disabled={!filePath}
          aria-label={isPlaying ? t("player:pause") : t("player:play")}
          data-tip={isPlaying ? t("player:pause") : t("player:play")}
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
        <button onClick={() => skip(5000)} disabled={!filePath} aria-label={t("player:forward5s")} data-tip={t("player:forward5s")} style={ctrlIcon(!filePath)}>
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

// Whole-line entrance keyframes for blur (by direction) and blurDrop. Per-unit
// types (scale/slide/staircase) pick their keyframe in AnimatedCaption. All are
// one-shot mount animations (`both` fill), keyed by cue id so they restart per
// cue; fade/typewriter/decode/karaoke are JS-driven off nowMs so they track
// scrubbing.
const BLUR_KEYFRAME: Record<string, string> = {
  in: "captionBlurIn",
  left: "captionBlurLeft",
  right: "captionBlurRight",
};
const BLURDROP_KEYFRAME: Record<string, string> = {
  up: "captionBlurDropTop", // origin top → drops down into place
  down: "captionBlurDropBottom", // origin bottom → rises up
};
const STAIRCASE_KEYFRAME: Record<string, string> = {
  up: "captionStairFromTop",
  down: "captionStairFromBottom",
};

/** Split a cue's text into the units that animate as one step. Word/sentence
 *  tokens keep trailing whitespace so inter-word spacing survives inline-block
 *  layout; line splits on the embedded \n the preview already honours. */
function splitUnits(text: string, granularity: AnimationGranularity): string[] {
  switch (granularity) {
    case "char":
      return [...text];
    case "line":
      return text.split("\n");
    case "sentence":
      return text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
    case "word":
    default:
      return text.match(/\S+\s*/g) ?? [text];
  }
}

// Stable per-cue reveal order for `decode`: hash (cue id, char index) so the
// scramble is deterministic across the 60fps re-renders and seeks.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
// Glyph pool + flip cadence for the `decode` scramble. hashStr keyed by
// (cue id, char index, frame) makes the shown glyph a deterministic function of
// the playhead, so it animates over time yet stays stable across re-renders.
const DECODE_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$*<>/\\";
const DECODE_GLYPH_MS = 45;

/** Animation-aware caption span. Mirrors what the ASS export burns into the MP4
 *  (the CSS follows the ASS, never the reverse). `sub === null` is the
 *  positioning sample, which renders plain. Mounted with a cue-id key so
 *  entrance keyframes restart per cue. */
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
    const spanStyle: React.CSSProperties = {
      ...base,
      animationName: fadingOut ? undefined : "captionFadeIn",
      animationDuration: fadingOut ? undefined : `${animation.durationMs}ms`,
      animationTimingFunction: "linear",
      opacity: fadingOut ? Math.max(0, remaining / animation.durationMs) : 1,
    };
    return <span style={spanStyle}>{sub.text}</span>;
  }

  // Whole-line entrance keyframes (no per-unit split): blur, blurDrop, colorShift.
  if (type === "blur" || type === "blurDrop" || type === "colorShift") {
    const keyframe =
      type === "blur"
        ? BLUR_KEYFRAME[animation.direction] ?? "captionBlurIn"
        : type === "blurDrop"
          ? BLURDROP_KEYFRAME[animation.direction] ?? "captionBlurDropTop"
          : "captionColorShift";
    return (
      <span
        style={{
          ...base,
          animation: `${keyframe} ${animation.durationMs}ms ease-out both`,
          // colorShift sweeps toward the chosen accent colour (read by the
          // keyframe as --kf-accent), then settles back to textColor.
          ...(type === "colorShift"
            ? ({ "--kf-accent": hexToCssColor(animation.highlightColor) } as React.CSSProperties)
            : {}),
        }}
      >
        {sub.text}
      </span>
    );
  }

  // Per-unit staggered entrance: scale, slide, staircase.
  if (type === "scale" || type === "slide" || type === "staircase") {
    const keyframe =
      type === "scale"
        ? "captionScaleIn"
        : type === "slide"
          ? "captionSlideUp"
          : STAIRCASE_KEYFRAME[animation.direction] ?? "captionStairFromTop";
    const units = splitUnits(sub.text, animation.granularity);
    const asBlock = animation.granularity === "line";
    return (
      <span style={base}>
        {units.map((u, i) => (
          <span
            key={i}
            style={{
              display: asBlock ? "block" : "inline-block",
              whiteSpace: "pre",
              animation: `${keyframe} ${animation.durationMs}ms ease-out both`,
              animationDelay: `${i * animation.staggerMs}ms`,
            }}
          >
            {u}
          </span>
        ))}
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

  if (type === "decode") {
    // Left-to-right "matrix decode": each character cycles random glyphs during
    // its scramble window, then settles to the real character. staggerMs = how
    // fast the decode wave moves left→right; durationMs = scramble length per
    // character. Character i starts scrambling at startMs, settles at settleMs.
    const chars = [...sub.text];
    const step = Math.max(animation.staggerMs, 1);
    const scramble = Math.max(animation.durationMs, 1);
    return (
      <span style={base}>
        {chars.map((c, i) => {
          if (c === "\n") return <br key={i} />;
          if (c === " ") return <span key={i}> </span>;
          const startMs = sub.startTime + i * step;
          const settleMs = startMs + scramble;
          let shown = c;
          if (nowMs < startMs) shown = ""; // not reached yet
          else if (nowMs < settleMs) {
            const frame = Math.floor((nowMs - startMs) / DECODE_GLYPH_MS);
            shown = DECODE_GLYPHS[hashStr(`${sub.id}:${i}:${frame}`) % DECODE_GLYPHS.length];
          }
          return (
            <span key={i} style={{ display: "inline-block" }}>
              {shown}
            </span>
          );
        })}
      </span>
    );
  }

  if (type === "karaoke") {
    // Per-word spans override colour and/or draw a highlight box (box-shadow
    // spread, so toggling it never reflows the line). The wrapper keeps the
    // single captionTextCss textShadow.
    const mode = animation.karaokeHighlight;
    const textColor = hexToCssColor(style.textColor);
    const hl = hexToCssColor(animation.highlightColor);
    // 8-digit-normalised highlight → ~40% alpha for the "both" box.
    const hlDim = hexToCssColor(`${animation.highlightColor.slice(0, 7)}66`);
    return (
      <span style={base}>
        {karaokeSegments(sub, nowMs).map((seg, i) => {
          let color = textColor;
          let boxColor: string | undefined;
          if (seg.sung) {
            if (mode === "text") color = hl;
            else if (mode === "background") boxColor = hl;
            else {
              color = hl;
              boxColor = hlDim;
            }
          }
          return (
            <span
              key={i}
              style={{
                color,
                backgroundColor: boxColor,
                boxShadow: boxColor ? `0 0 0 0.1em ${boxColor}` : undefined,
                borderRadius: boxColor ? "0.15em" : undefined,
              }}
            >
              {seg.text}
            </span>
          );
        })}
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
