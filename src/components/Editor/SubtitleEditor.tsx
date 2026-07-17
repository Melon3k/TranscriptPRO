import { useRef, useEffect, useState, useCallback } from "react";
import { Copy, X, ListX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { usePlayerStore } from "../../stores/playerStore";
import SubtitleRow, { type WordDragPayload } from "./SubtitleRow";
import { COLORS, f, FONTS } from "../../lib/ui";

/** The 252px segment-list column. Owns word selection + active-row tracking. */
export default function SubtitleEditor() {
  const { t } = useTranslation(["editor"]);
  const {
    subtitles,
    updateSubtitle,
    splitSegment,
    mergeUp,
    mergeDown,
    deleteSegment,
    moveWords,
  } = useSubtitleStore();
  const currentTimeMs = usePlayerStore((s) => s.currentTimeMs);
  const setCurrentTimeMs = usePlayerStore((s) => s.setCurrentTimeMs);

  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedWords, setSelectedWords] = useState<Map<string, Set<number>>>(new Map());

  const totalSelected = Array.from(selectedWords.values()).reduce((n, s) => n + s.size, 0);
  const sourceSubIds = new Set(selectedWords.keys());

  const activeSub = subtitles.find((s) => currentTimeMs >= s.startTime && currentTimeMs < s.endTime);
  const activeId = activeSub?.id;

  let activeWordIndex: number | null = null;
  if (activeSub && activeSub.words.length > 0) {
    const wi = activeSub.words.findIndex((w) => currentTimeMs >= w.startTime && currentTimeMs < w.endTime);
    if (wi !== -1) activeWordIndex = wi;
  }

  useEffect(() => {
    if (activeRef.current && listRef.current) {
      const c = listRef.current.getBoundingClientRect();
      const el = activeRef.current.getBoundingClientRect();
      if (el.top < c.top || el.bottom > c.bottom) {
        activeRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [activeId]);

  const clearSelection = useCallback(() => setSelectedWords(new Map()), []);

  const toggleWord = useCallback((subId: string, wi: number) => {
    setSelectedWords((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(subId) ?? []);
      if (set.has(wi)) {
        set.delete(wi);
        if (set.size === 0) next.delete(subId);
        else next.set(subId, set);
      } else {
        set.add(wi);
        next.set(subId, set);
      }
      return next;
    });
  }, []);

  const moveHere = useCallback(
    (targetId: string, insertAt?: number) => {
      for (const [srcId, idxs] of selectedWords.entries()) {
        if (srcId !== targetId) moveWords(srcId, Array.from(idxs), targetId, insertAt);
      }
      clearSelection();
    },
    [selectedWords, moveWords, clearSelection],
  );

  const wordDrop = useCallback(
    (targetId: string, payload: WordDragPayload, insertAt?: number) => {
      moveWords(payload.sourceSubId, payload.wordIndices, targetId, insertAt);
      setSelectedWords((prev) => {
        const next = new Map(prev);
        next.delete(payload.sourceSubId);
        return next;
      });
    },
    [moveWords],
  );

  const selectSeg = useCallback(
    (id: string) => {
      setSelectedId(id);
      const seg = subtitles.find((s) => s.id === id);
      if (seg) setCurrentTimeMs(seg.startTime);
    },
    [subtitles, setCurrentTimeMs],
  );

  return (
    <div
      style={{
        width: 504,
        flex: "none",
        background: "var(--c-panel)",
        borderRight: "1px solid var(--c-border)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "12px 14px 10px",
          borderBottom: "1px solid var(--c-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={f(600, 13, "display")}>{t("editor:segments")}</span>
        <span style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: 10, color: "var(--c-muted)" }}>
          {subtitles.length}
        </span>
      </div>

      {totalSelected > 0 && (
        <div
          style={{
            margin: "8px 12px 0",
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 30,
            padding: "0 11px",
            background: "rgba(124,58,237,.14)",
            border: `1px solid ${COLORS.violet}`,
            borderRadius: 8,
          }}
        >
          <Copy size={13} color={COLORS.violetLight} />
          <span style={f(600, 10, "body", { color: "#c4b5fd" })}>
            {t("editor:selectionBanner", { count: totalSelected })}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={clearSelection} style={{ background: "none", border: "none", cursor: "pointer", color: COLORS.violetLight, display: "flex", padding: 0 }}>
            <X size={13} />
          </button>
        </div>
      )}

      {subtitles.length === 0 ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            color: "var(--c-muted)",
            padding: 20,
            textAlign: "center",
          }}
        >
          <ListX size={40} strokeWidth={1} />
          <p style={f(500, 12, "body", { color: "var(--c-text2)", margin: 0 })}>{t("editor:emptyTitle")}</p>
          <p style={f(400, 11, "body", { color: "var(--c-muted)", margin: 0 })}>{t("editor:emptyHint")}</p>
        </div>
      ) : (
        <div
          ref={listRef}
          style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 7 }}
        >
          {subtitles.map((sub, i) => {
            const isActive = sub.id === activeId;
            const isDropTarget = totalSelected > 0 && !sourceSubIds.has(sub.id);
            return (
              <div key={sub.id} ref={isActive ? activeRef : undefined}>
                <SubtitleRow
                  subtitle={sub}
                  isActive={isActive}
                  isSelected={sub.id === selectedId}
                  activeWordIndex={isActive ? activeWordIndex : null}
                  selectedWordIndices={selectedWords.get(sub.id)}
                  isDropTarget={isDropTarget}
                  onUpdate={updateSubtitle}
                  onSplit={splitSegment}
                  onMergeUp={mergeUp}
                  onMergeDown={mergeDown}
                  onDelete={deleteSegment}
                  onSeek={setCurrentTimeMs}
                  onSelect={selectSeg}
                  onWordToggleSelect={toggleWord}
                  onMoveWordsHere={moveHere}
                  onWordDrop={wordDrop}
                  isFirst={i === 0}
                  isLast={i === subtitles.length - 1}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
