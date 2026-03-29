import { useRef, useEffect } from "react";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { usePlayerStore } from "../../stores/playerStore";
import SubtitleRow from "./SubtitleRow";
import ComparisonRow from "./ComparisonRow";
import { ListX } from "lucide-react";

export default function SubtitleEditor() {
  const {
    subtitles,
    updateSubtitle,
    splitSegment,
    mergeUp,
    mergeDown,
    deleteSegment,
    originalSubtitles,
    comparisonMode,
  } = useSubtitleStore();
  const { currentTimeMs, setCurrentTimeMs } = usePlayerStore();
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  // Find active subtitle based on current playback time
  const activeSub = subtitles.find(
    (s) => currentTimeMs >= s.startTime && currentTimeMs < s.endTime
  );
  const activeId = activeSub?.id;

  // Find active word within active subtitle
  let activeWordIndex: number | null = null;
  if (activeSub && activeSub.words.length > 0) {
    const wi = activeSub.words.findIndex(
      (w) => currentTimeMs >= w.startTime && currentTimeMs < w.endTime
    );
    if (wi !== -1) activeWordIndex = wi;
  }

  // Auto-scroll to active subtitle
  useEffect(() => {
    if (activeRef.current && listRef.current) {
      const container = listRef.current;
      const el = activeRef.current;
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();

      if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [activeId]);

  if (subtitles.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 gap-3">
        <ListX size={48} strokeWidth={1} />
        <p className="text-sm">No subtitles loaded</p>
        <p className="text-xs text-gray-300 dark:text-gray-600">
          Open a media file or import an SRT
        </p>
      </div>
    );
  }

  // Comparison mode: side-by-side original vs translated
  if (comparisonMode && originalSubtitles) {
    return (
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {subtitles.map((sub, i) => {
          const original = originalSubtitles[i];
          const isActive = sub.id === activeId;
          return (
            <div key={sub.id} ref={isActive ? activeRef : undefined}>
              {original ? (
                <ComparisonRow
                  original={original}
                  translated={sub}
                  isActive={isActive}
                />
              ) : (
                <SubtitleRow
                  subtitle={sub}
                  isActive={isActive}
                  activeWordIndex={isActive ? activeWordIndex : null}
                  onUpdate={updateSubtitle}
                  onSplit={splitSegment}
                  onMergeUp={mergeUp}
                  onMergeDown={mergeDown}
                  onDelete={deleteSegment}
                  onSeek={setCurrentTimeMs}
                  isFirst={i === 0}
                  isLast={i === subtitles.length - 1}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Normal mode
  return (
    <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
      {subtitles.map((sub, i) => (
        <div key={sub.id} ref={sub.id === activeId ? activeRef : undefined}>
          <SubtitleRow
            subtitle={sub}
            isActive={sub.id === activeId}
            activeWordIndex={sub.id === activeId ? activeWordIndex : null}
            onUpdate={updateSubtitle}
            onSplit={splitSegment}
            onMergeUp={mergeUp}
            onMergeDown={mergeDown}
            onDelete={deleteSegment}
            onSeek={setCurrentTimeMs}
            isFirst={i === 0}
            isLast={i === subtitles.length - 1}
          />
        </div>
      ))}
    </div>
  );
}
