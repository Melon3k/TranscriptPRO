import { useState, useEffect, memo, type CSSProperties } from "react";
import { Scissors, ChevronDown, Trash2, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Subtitle, Word } from "../../types/subtitle";
import { formatTimestamp, parseTimestamp } from "../../lib/time-format";
import { hasInvertedTiming } from "../../lib/subtitle-ops";
import { COLORS, f, FONTS } from "../../lib/ui";
import type { WordDragPayload } from "../../hooks/useWordDrag";

export type { WordDragPayload } from "../../hooks/useWordDrag";

/**
 * Rebuild word tokens from edited sentence text, spreading the segment's time
 * range evenly across the new words. The segment card renders word chips (not the
 * raw text), so a text edit must regenerate the chips or it wouldn't show up.
 * Per-word timing becomes approximate for manually edited segments — acceptable.
 */
function retokenize(text: string, start: number, end: number): Word[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const dur = Math.max(0, end - start);
  const step = dur / tokens.length;
  return tokens.map((tok, i) => ({
    text: tok,
    startTime: Math.round(start + i * step),
    endTime: Math.round(start + (i + 1) * step),
  }));
}

interface SubtitleRowProps {
  subtitle: Subtitle;
  isActive: boolean;
  activeWordIndex: number | null;
  selectedWordIndices?: Set<number>;
  isDropTarget?: boolean;
  onUpdate: (id: string, changes: Partial<Subtitle>) => void;
  onSplit: (id: string) => void;
  onMergeUp: (id: string) => void;
  onMergeDown: (id: string) => void;
  onDelete: (id: string) => void;
  onSeek: (ms: number) => void;
  onSelect: (id: string) => void;
  onWordToggleSelect?: (subtitleId: string, wordIdx: number) => void;
  onMoveWordsHere?: (targetSubId: string, insertAt?: number) => void;
  onWordDragStart?: (e: React.PointerEvent, payload: WordDragPayload, label: string) => void;
  dragHoverInsertAt?: number | null;
  isSelected: boolean;
  isFirst: boolean;
  isLast: boolean;
}

// Deterministic speaker → colour, matching the design's badge palette.
const SPEAKER_COLORS: { bc: string; bt: string }[] = [
  { bc: COLORS.blue, bt: "#fff" },
  { bc: COLORS.cyan, bt: "#0D1117" },
  { bc: COLORS.violet, bt: "#fff" },
  { bc: COLORS.amber, bt: "#0D1117" },
  { bc: COLORS.green, bt: "#0D1117" },
  { bc: COLORS.red, bt: "#fff" },
];

function SubtitleRow({
  subtitle,
  isActive,
  activeWordIndex,
  selectedWordIndices,
  isDropTarget,
  onUpdate,
  onSplit,
  onMergeUp,
  onMergeDown,
  onDelete,
  onSeek,
  onSelect,
  onWordToggleSelect,
  onMoveWordsHere,
  onWordDragStart,
  dragHoverInsertAt,
  isSelected,
  isFirst,
  isLast,
}: SubtitleRowProps) {
  const { t } = useTranslation(["editor"]);
  const [editing, setEditing] = useState(false);
  const [editingText, setEditingText] = useState(subtitle.text);

  useEffect(() => setEditingText(subtitle.text), [subtitle.text]);

  const hasWords = subtitle.words && subtitle.words.length > 0;

  const commit = () => {
    const trimmed = editingText.trim();
    if (trimmed !== subtitle.text.trim()) {
      // Update both the sentence text and the word chips so the segment card
      // reflects the edit (chips are derived from `words`, not `text`).
      const changes: Partial<Subtitle> = { text: trimmed };
      if (subtitle.words.length > 0) {
        changes.words = retokenize(trimmed, subtitle.startTime, subtitle.endTime);
      }
      onUpdate(subtitle.id, changes);
    }
    setEditing(false);
  };

  const handleWordClick = (e: React.MouseEvent, wi: number) => {
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      e.preventDefault();
      onWordToggleSelect?.(subtitle.id, wi);
    } else {
      onSeek(subtitle.words[wi].startTime);
    }
  };

  const handleWordPointerDown = (e: React.PointerEvent, wi: number) => {
    // modified clicks are word-selection, never drags
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    // A retokenizing text edit can leave stale out-of-range indices in the
    // selection Set (same subtitle id, fewer words) — drop them or we'd
    // dereference undefined below.
    const valid =
      selectedWordIndices && selectedWordIndices.has(wi)
        ? Array.from(selectedWordIndices).filter((i) => i >= 0 && i < subtitle.words.length)
        : [wi];
    const indices = valid.length > 0 ? valid : [wi];
    const payload: WordDragPayload = { sourceSubId: subtitle.id, wordIndices: indices };
    const label =
      subtitle.words[indices[0]].text + (indices.length > 1 ? ` +${indices.length - 1}` : "");
    onWordDragStart?.(e, payload, label);
  };

  // Non-blocking inverted-time signal: TimeCode deliberately allows transient
  // start >= end (users move a segment by editing start first), so flag it
  // visually instead. Export additionally warns so it can't ship silently.
  const isInverted = hasInvertedTiming(subtitle);

  const border = isDropTarget
    ? `1px solid ${COLORS.violet}`
    : isInverted
      ? `1px solid ${COLORS.red}`
      : isActive || isSelected
        ? `1px solid ${COLORS.blue}`
        : "1px solid var(--c-border)";
  const background = isDropTarget
    ? "rgba(124,58,237,.08)"
    : isInverted
      ? "rgba(240,67,91,.06)"
      : isActive || isSelected
        ? "rgba(37,99,255,.08)"
        : "var(--c-raised)";

  const spk = subtitle.speaker ? speakerShort(subtitle.speaker) : null;
  const spkColor = spk ? SPEAKER_COLORS[(spk.num - 1) % SPEAKER_COLORS.length] : null;

  return (
    <div
      data-word-row={subtitle.id}
      onClick={() => onSelect(subtitle.id)}
      style={{ borderRadius: 8, border, background, padding: "9px 11px", cursor: "pointer" }}
    >
      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: FONTS.mono, fontWeight: 600, fontSize: 9, color: isActive || isSelected ? COLORS.blueLight : "var(--c-muted)" }}>
            #{subtitle.index}
          </span>
          {spk && spkColor && (
            <span
              title={subtitle.speaker}
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                background: spkColor.bc,
                color: spkColor.bt,
                fontFamily: FONTS.body,
                fontWeight: 700,
                fontSize: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              S{spk.num}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <ActionBtn title={t("editor:actions.split")} onClick={(e) => { e.stopPropagation(); onSplit(subtitle.id); }}>
            <Scissors size={13} />
          </ActionBtn>
          <ActionBtn
            title={t("editor:actions.mergeUp")}
            disabled={isFirst}
            onClick={(e) => { e.stopPropagation(); if (!isFirst) onMergeUp(subtitle.id); }}
          >
            <ChevronDown size={13} style={{ transform: "rotate(180deg)" }} />
          </ActionBtn>
          <ActionBtn
            title={t("editor:actions.mergeDown")}
            disabled={isLast}
            onClick={(e) => { e.stopPropagation(); if (!isLast) onMergeDown(subtitle.id); }}
          >
            <ChevronDown size={13} />
          </ActionBtn>
          <ActionBtn title={t("editor:actions.delete")} danger onClick={(e) => { e.stopPropagation(); onDelete(subtitle.id); }}>
            <Trash2 size={13} />
          </ActionBtn>
        </div>
      </div>

      {/* body */}
      {editing ? (
        <>
          <textarea
            value={editingText}
            autoFocus
            onChange={(e) => setEditingText(e.target.value)}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
              else if (e.key === "Escape") { setEditingText(subtitle.text); setEditing(false); }
            }}
            style={{
              width: "100%",
              boxSizing: "border-box",
              minHeight: 52,
              resize: "none",
              background: "var(--c-input)",
              border: `1px solid ${COLORS.blue}`,
              borderRadius: 7,
              padding: "7px 9px",
              color: "var(--c-text)",
              outline: "none",
              ...f(400, 11, "body", { lineHeight: 1.4 }),
            }}
          />
          <div style={f(400, 8, "body", { color: "var(--c-muted)", marginTop: 3 })}>{t("editor:editHint")}</div>
        </>
      ) : (
        <div
          onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
          title={t("editor:doubleClickToEdit")}
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 3 }}
        >
          {hasWords ? (
            <WordChips
              subtitle={subtitle}
              activeWordIndex={activeWordIndex}
              selectedWordIndices={selectedWordIndices}
              isDropTarget={!!isDropTarget}
              dragHoverInsertAt={dragHoverInsertAt}
              onWordClick={handleWordClick}
              onWordPointerDown={handleWordPointerDown}
              onMoveWordsHere={onMoveWordsHere}
            />
          ) : (
            <p style={f(400, 11, "body", { color: "var(--c-text2)", lineHeight: 1.4, margin: 0 })}>{subtitle.text}</p>
          )}
        </div>
      )}

      {/* footer timecodes (double-click to edit) */}
      <div style={{ marginTop: 7, display: "flex", gap: 6, alignItems: "center" }}>
        <TimeCode value={subtitle.startTime} onSeek={onSeek} onChange={(ms) => onUpdate(subtitle.id, { startTime: ms })} invalid={isInverted} />
        <span style={{ fontFamily: FONTS.mono, fontSize: 9, color: "var(--c-muted)" }}>→</span>
        <TimeCode value={subtitle.endTime} onSeek={onSeek} onChange={(ms) => onUpdate(subtitle.id, { endTime: ms })} invalid={isInverted} />
        {isInverted && (
          <span
            title={t("editor:invertedTime")}
            style={{ display: "flex", alignItems: "center", gap: 4, color: COLORS.red, ...f(600, 9) }}
          >
            <AlertTriangle size={11} />
            {t("editor:invertedTime")}
          </span>
        )}
      </div>
    </div>
  );
}

function WordChips({
  subtitle,
  activeWordIndex,
  selectedWordIndices,
  isDropTarget,
  dragHoverInsertAt,
  onWordClick,
  onWordPointerDown,
  onMoveWordsHere,
}: {
  subtitle: Subtitle;
  activeWordIndex: number | null;
  selectedWordIndices?: Set<number>;
  isDropTarget: boolean;
  dragHoverInsertAt?: number | null;
  onWordClick: (e: React.MouseEvent, wi: number) => void;
  onWordPointerDown: (e: React.PointerEvent, wi: number) => void;
  onMoveWordsHere?: (targetSubId: string, insertAt?: number) => void;
}) {
  const chip = (wi: number): CSSProperties => {
    const sel = selectedWordIndices?.has(wi) ?? false;
    const activeWord = activeWordIndex === wi;
    return {
      fontFamily: FONTS.body,
      fontSize: 10.5,
      padding: "2px 6px",
      borderRadius: 5,
      cursor: "grab",
      userSelect: "none",
      touchAction: "none",
      border: `1px solid ${sel ? COLORS.violet : "transparent"}`,
      background: sel ? "rgba(124,58,237,.22)" : activeWord ? "rgba(37,99,255,.22)" : "var(--c-input)",
      color: sel ? COLORS.violetLight : activeWord ? COLORS.blueLight : "var(--c-text2)",
    };
  };

  const zone = (k: number): CSSProperties => ({
    width: dragHoverInsertAt === k ? 6 : 4,
    alignSelf: "stretch",
    minHeight: 18,
    borderRadius: 3,
    background: dragHoverInsertAt === k ? "rgba(124,58,237,.9)" : "rgba(124,58,237,.55)",
    flex: "none",
    cursor: "pointer",
  });

  const dropZone = (k: number) => (
    <span
      key={`z${k}`}
      data-word-zone={k}
      style={zone(k)}
      onClick={(e) => { e.stopPropagation(); onMoveWordsHere?.(subtitle.id, k); }}
    />
  );

  const words = subtitle.words.map((w, wi) => (
    <span
      key={`w${wi}`}
      onClick={(e) => onWordClick(e, wi)}
      onPointerDown={(e) => onWordPointerDown(e, wi)}
      style={chip(wi)}
    >
      {w.text}
    </span>
  ));

  // When this row is a drop target, interleave insertion zones between words.
  if (isDropTarget) {
    const out: React.ReactNode[] = [dropZone(0)];
    subtitle.words.forEach((_, wi) => {
      out.push(words[wi]);
      out.push(dropZone(wi + 1));
    });
    return <>{out}</>;
  }
  return <>{words}</>;
}

function TimeCode({
  value,
  onSeek,
  onChange,
  invalid,
}: {
  value: number;
  onSeek: (ms: number) => void;
  onChange: (ms: number) => void;
  invalid?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatTimestamp(value));
  useEffect(() => setDraft(formatTimestamp(value)), [value]);

  const commit = () => {
    const ms = parseTimestamp(draft);
    if (ms !== null && ms >= 0) onChange(ms);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        className="timestamp-input"
        value={draft}
        autoFocus
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        style={{
          width: 92,
          background: "var(--c-input)",
          border: `1px solid ${COLORS.blue}`,
          borderRadius: 5,
          padding: "1px 5px",
          color: "var(--c-text)",
          outline: "none",
        }}
      />
    );
  }
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onSeek(value); }}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
      style={{
        fontFamily: FONTS.mono,
        fontWeight: 500,
        fontSize: 9,
        color: invalid ? COLORS.red : "var(--c-muted)",
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
      }}
    >
      {formatTimestamp(value)}
    </button>
  );
}

function ActionBtn({
  title,
  onClick,
  disabled,
  danger,
  children,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 22,
        height: 22,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 5,
        background: "none",
        border: "none",
        cursor: disabled ? "default" : "pointer",
        color: danger ? COLORS.red : "var(--c-muted)",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      {children}
    </button>
  );
}

function speakerShort(speaker: string): { num: number } {
  const num = parseInt(speaker.replace(/\D/g, ""), 10) || 1;
  return { num };
}

export default memo(SubtitleRow);
