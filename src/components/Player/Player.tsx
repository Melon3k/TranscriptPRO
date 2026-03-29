import { useRef, useEffect, useCallback } from "react";
import { Play, Pause, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { usePlayerStore } from "../../stores/playerStore";
import { formatDuration } from "../../lib/time-format";
import { convertFileSrc } from "@tauri-apps/api/core";

export default function Player() {
  const {
    filePath,
    currentTimeMs,
    duration,
    isPlaying,
    setCurrentTimeMs,
    setDuration,
    setIsPlaying,
  } = usePlayerStore();

  const mediaRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // Sync store → media element when seeking from editor
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    const elTimeMs = el.currentTime * 1000;
    // Only seek if difference is significant (>200ms) to avoid feedback loops
    if (Math.abs(elTimeMs - currentTimeMs) > 200) {
      el.currentTime = currentTimeMs / 1000;
    }
  }, [currentTimeMs]);

  // Time update from media element → store
  const handleTimeUpdate = useCallback(() => {
    const el = mediaRef.current;
    if (el) setCurrentTimeMs(el.currentTime * 1000);
  }, [setCurrentTimeMs]);

  const handleLoadedMetadata = useCallback(() => {
    const el = mediaRef.current;
    if (el) setDuration(el.duration);
  }, [setDuration]);

  const togglePlay = () => {
    const el = mediaRef.current;
    if (!el || !filePath) return;
    if (el.paused) {
      el.play();
      setIsPlaying(true);
    } else {
      el.pause();
      setIsPlaying(false);
    }
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

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      {/* Video/audio element */}
      {mediaSrc && (
        <video
          ref={mediaRef}
          src={mediaSrc}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={() => setIsPlaying(false)}
          className="w-full max-h-[300px] bg-black object-contain"
          preload="metadata"
        />
      )}

      {/* Progress bar */}
      <div
        ref={progressRef}
        className="h-1.5 bg-gray-200 dark:bg-gray-700 cursor-pointer group"
        onClick={handleProgressClick}
      >
        <div
          className="h-full bg-blue-500 dark:bg-blue-400 transition-[width] duration-100 group-hover:bg-blue-600"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 px-4 py-2">
        <button
          onClick={() => skip(-5000)}
          className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30"
          disabled={!filePath}
          title="Back 5s"
        >
          <SkipBack size={16} />
        </button>

        <button
          onClick={togglePlay}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-30 disabled:hover:bg-blue-500 transition-colors"
          disabled={!filePath}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>

        <button
          onClick={() => skip(5000)}
          className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30"
          disabled={!filePath}
          title="Forward 5s"
        >
          <SkipForward size={16} />
        </button>

        <span className="text-xs font-mono text-gray-500 dark:text-gray-400 min-w-[5rem]">
          {formatDuration(currentTimeMs / 1000)}
          <span className="text-gray-300 dark:text-gray-600"> / </span>
          {formatDuration(duration)}
        </span>

        <div className="flex-1" />

        <Volume2 size={14} className="text-gray-400 dark:text-gray-500" />
      </div>
    </div>
  );
}
