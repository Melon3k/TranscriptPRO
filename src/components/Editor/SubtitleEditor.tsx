import { useRef, useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { usePlayerStore } from "../../stores/playerStore";
import SubtitleRow from "./SubtitleRow";
import type { WordDragPayload } from "./SubtitleRow";
import ComparisonRow from "./ComparisonRow";
import { ListX, X } from "lucide-react";

export default function SubtitleEditor() {
  const { t } = useTranslation(["editor", "common"]);
  const {
    subtitles,
    updateSubtitle,
    splitSegment,
    mergeUp,
    mergeDown,
    deleteSegment,
    moveWords,
    originalSubtitles,
    comparisonMode,
  } = useSubtitleStore();
  // Select only the fields we use so playback state we don't care about (isPlaying,
  // duration) doesn't re-render the editor. currentTimeMs still ticks, but SubtitleRow
  // is memoized so only the active/previously-active rows actually re-render.
  const currentTimeMs = usePlayerStore((s) => s.currentTimeMs);
  const setCurrentTimeMs = usePlayerStore((s) => s.setCurrentTimeMs);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  // word selection: Map<subtitleId, Set<wordIndex>>
  const [selectedWords, setSelectedWords] = useState<Map<string, Set<number>>>(
    new Map()
  );

  const totalSelected = Array.from(selectedWords.values()).reduce(
    (sum, s) => sum + s.size,
    0
  );
  // source subtitle IDs (those with selected words)
  const sourceSubIds = new Set(selectedWords.keys());

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

  const handleWordToggleSelect = useCallback(
    (subtitleId: string, wordIdx: number) => {
      setSelectedWords((prev) => {
        const next = new Map(prev);
        const existing = new Set(next.get(subtitleId) ?? []);
        if (existing.has(wordIdx)) {
          existing.delete(wordIdx);
          if (existing.size === 0) next.delete(subtitleId);
          else next.set(subtitleId, existing);
        } else {
          existing.add(wordIdx);
          next.set(subtitleId, existing);
        }
        return next;
      });
    },
    []
  );

  const clearSelection = useCallback(() => setSelectedWords(new Map()), []);

  const handleMoveWordsHere = useCallback(
    (targetSubId: string, insertAt?: number) => {
      for (const [sourceSubId, wordIndices] of selectedWords.entries()) {
        if (sourceSubId !== targetSubId) {
          moveWords(sourceSubId, Array.from(wordIndices), targetSubId, insertAt);
        }
      }
      clearSelection();
    },
    [selectedWords, moveWords, clearSelection]
  );

  const handleWordDrop = useCallback(
    (targetSubId: string, payload: WordDragPayload, insertAt?: number) => {
      moveWords(payload.sourceSubId, payload.wordIndices, targetSubId, insertAt);
      setSelectedWords((prev) => {
        const next = new Map(prev);
        next.delete(payload.sourceSubId);
        return next;
      });
    },
    [moveWords]
  );

  if (subtitles.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 gap-3">
        <ListX size={48} strokeWidth={1} />
        <p className="text-sm">{t("editor:emptyTitle")}</p>
        <p className="text-xs text-gray-300 dark:text-gray-600">
          {t("editor:emptyHint")}
        </p>
      </div>
    );
  }

  const selectionBanner = totalSelected > 0 && (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-violet-50 dark:bg-violet-900/20 border-b border-violet-200 dark:border-violet-700 text-xs text-violet-700 dark:text-violet-300">
      <span className="flex-1">
        {t("editor:selectionBanner", { count: totalSelected })}
      </span>
      <button
        onClick={clearSelection}
        className="text-violet-400 hover:text-violet-600 dark:hover:text-violet-200"
        title={t("editor:clearSelection")}
      >
        <X size={13} />
      </button>
    </div>
  );

  const renderRow = (sub: typeof subtitles[0], i: number) => {
    const isActive = sub.id === activeId;
    // A row is a drop target when words are selected AND this subtitle doesn't own them
    const isDropTarget = totalSelected > 0 && !sourceSubIds.has(sub.id);
    return (
      <div key={sub.id} ref={isActive ? activeRef : undefined}>
        <SubtitleRow
          subtitle={sub}
          isActive={isActive}
          activeWordIndex={isActive ? activeWordIndex : null}
          selectedWordIndices={selectedWords.get(sub.id)}
          isDropTarget={isDropTarget}
          onUpdate={updateSubtitle}
          onSplit={splitSegment}
          onMergeUp={mergeUp}
          onMergeDown={mergeDown}
          onDelete={deleteSegment}
          onSeek={setCurrentTimeMs}
          onWordToggleSelect={handleWordToggleSelect}
          onMoveWordsHere={handleMoveWordsHere}
          onWordDrop={handleWordDrop}
          isFirst={i === 0}
          isLast={i === subtitles.length - 1}
        />
      </div>
    );
  };

  // Comparison mode: side-by-side original vs translated
  if (comparisonMode && originalSubtitles) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectionBanner}
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
                  renderRow(sub, i)
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Normal mode
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {selectionBanner}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {subtitles.map((sub, i) => renderRow(sub, i))}
      </div>
    </div>
  );
}
