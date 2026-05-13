import { useState, useRef, useEffect } from "react";
import { Scissors, ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Subtitle } from "../../types/subtitle";
import { formatTimestamp, parseTimestamp } from "../../lib/time-format";

export interface WordDragPayload {
  sourceSubId: string;
  wordIndices: number[];
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
  onWordToggleSelect?: (subtitleId: string, wordIdx: number) => void;
  onMoveWordsHere?: (targetSubId: string, insertAt?: number) => void;
  onWordDrop?: (targetSubId: string, payload: WordDragPayload, insertAt?: number) => void;
  isFirst: boolean;
  isLast: boolean;
}

export default function SubtitleRow({
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
  onWordToggleSelect,
  onMoveWordsHere,
  onWordDrop,
  isFirst,
  isLast,
}: SubtitleRowProps) {
  const { t } = useTranslation(["editor"]);
  const [editing, setEditing] = useState(false);
  const [editingText, setEditingText] = useState(subtitle.text);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragInsertIdx, setDragInsertIdx] = useState<number | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditingText(subtitle.text);
  }, [subtitle.text]);

  const handleTextBlur = () => {
    if (editingText !== subtitle.text) {
      onUpdate(subtitle.id, { text: editingText });
    }
    setEditing(false);
  };

  const handleTimeChange = (field: "startTime" | "endTime", value: string) => {
    const ms = parseTimestamp(value);
    if (ms !== null) {
      onUpdate(subtitle.id, { [field]: ms });
    }
  };

  const hasWords = subtitle.words && subtitle.words.length > 0;

  const handleWordClick = (e: React.MouseEvent, wordIdx: number) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      onWordToggleSelect?.(subtitle.id, wordIdx);
    } else {
      onSeek(subtitle.words[wordIdx].startTime);
    }
  };

  const handleWordDragStart = (e: React.DragEvent, wordIdx: number) => {
    const dragIndices =
      selectedWordIndices && selectedWordIndices.has(wordIdx)
        ? Array.from(selectedWordIndices)
        : [wordIdx];

    const payload: WordDragPayload = {
      sourceSubId: subtitle.id,
      wordIndices: dragIndices,
    };
    e.dataTransfer.setData("text/plain", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const insertAt = dragInsertIdx ?? undefined;
    setDragInsertIdx(null);
    const raw = e.dataTransfer.getData("text/plain");
    if (!raw) return;
    try {
      const payload: WordDragPayload = JSON.parse(raw);
      if (payload.sourceSubId !== subtitle.id) {
        onWordDrop?.(subtitle.id, payload, insertAt);
      }
    } catch {
      // ignore malformed payload
    }
  };

  const handleRowClick = (e: React.MouseEvent) => {
    if (isDropTarget && onMoveWordsHere) {
      e.stopPropagation();
      // Only fires when clicking the row background (not an insertion zone)
      onMoveWordsHere(subtitle.id, undefined);
    }
  };

  return (
    <div
      className={`group rounded-lg border px-3 py-2 transition-colors ${
        isDragOver
          ? "border-violet-400 dark:border-violet-500 bg-violet-50 dark:bg-violet-900/10 ring-1 ring-violet-300 dark:ring-violet-700"
          : isDropTarget
          ? "border-green-400 dark:border-green-500 bg-green-50 dark:bg-green-900/10 ring-1 ring-green-300 dark:ring-green-700 cursor-pointer"
          : isActive
          ? "border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20"
          : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleRowClick}
    >
      {isDropTarget && (
        <div className="text-[11px] text-green-600 dark:text-green-400 font-medium mb-1.5 flex items-center gap-1">
          <span>{t("editor:dropHereHint")}</span>
        </div>
      )}
      <div className="flex gap-2">
        {/* Index + Speaker */}
        <div className="flex flex-col items-center justify-center w-12 shrink-0 gap-0.5">
          <span className="text-xs font-mono text-gray-400 dark:text-gray-500">
            {subtitle.index}
          </span>
          {subtitle.speaker && (
            <SpeakerBadge speaker={subtitle.speaker} />
          )}
        </div>

        {/* Timestamps */}
        <div className="flex flex-col gap-1 shrink-0">
          <TimestampInput
            value={formatTimestamp(subtitle.startTime)}
            onChange={(v) => handleTimeChange("startTime", v)}
            onClick={() => onSeek(subtitle.startTime)}
          />
          <TimestampInput
            value={formatTimestamp(subtitle.endTime)}
            onChange={(v) => handleTimeChange("endTime", v)}
            onClick={() => onSeek(subtitle.endTime)}
          />
        </div>

        {/* Text / Words */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <textarea
              ref={textRef}
              className="w-full resize-none rounded border border-blue-300 dark:border-blue-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm leading-relaxed text-gray-800 dark:text-gray-200 focus:outline-none min-h-[3rem]"
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
              onBlur={handleTextBlur}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setEditingText(subtitle.text);
                  setEditing(false);
                }
              }}
              rows={2}
              autoFocus
            />
          ) : (
            <div
              className="px-2 py-1 cursor-text min-h-[2rem]"
              onDoubleClick={() => setEditing(true)}
              title={t("editor:doubleClickToEdit")}
            >
              {/* Sentence text */}
              <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200">
                {subtitle.text}
              </p>

              {/* Clickable + draggable words */}
              {hasWords && !isDropTarget && (
                <div className="flex flex-wrap gap-x-1 gap-y-0.5 mt-1.5">
                  {subtitle.words.map((word, wi) => {
                    const isSelected = selectedWordIndices?.has(wi) ?? false;
                    const isActiveWord = activeWordIndex === wi;
                    return (
                      <button
                        key={wi}
                        draggable
                        onClick={(e) => handleWordClick(e, wi)}
                        onDragStart={(e) => handleWordDragStart(e, wi)}
                        className={`text-xs px-1 py-0.5 rounded transition-colors cursor-grab active:cursor-grabbing select-none ${
                          isSelected
                            ? "bg-violet-200 dark:bg-violet-700/60 text-violet-800 dark:text-violet-200 ring-1 ring-violet-400 dark:ring-violet-500"
                            : isActiveWord
                            ? "bg-blue-200 dark:bg-blue-700 text-blue-800 dark:text-blue-100 font-medium"
                            : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200"
                        }`}
                        title={
                          isSelected
                            ? t("editor:wordSelected")
                            : t("editor:wordTooltip", {
                                startTime: formatTimestamp(word.startTime),
                                endTime: formatTimestamp(word.endTime),
                              })
                        }
                      >
                        {word.text}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Drop target: words with insertion zones */}
              {isDropTarget && (
                <div
                  className="flex flex-wrap gap-y-1 mt-1.5 items-center"
                  onDragOver={(e) => e.stopPropagation()}
                >
                  {hasWords ? (
                    <>
                      <InsertionZone
                        index={0}
                        active={dragInsertIdx === 0}
                        onHover={() => setDragInsertIdx(0)}
                        onClick={(e) => { e.stopPropagation(); onMoveWordsHere?.(subtitle.id, 0); }}
                        onDragOver={() => setDragInsertIdx(0)}
                        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onWordDrop?.(subtitle.id, JSON.parse(e.dataTransfer.getData("text/plain")), 0); setDragInsertIdx(null); setIsDragOver(false); }}
                      />
                      {subtitle.words.map((word, wi) => (
                        <span key={wi} className="flex items-center">
                          <span className="text-xs px-1 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 select-none">
                            {word.text}
                          </span>
                          <InsertionZone
                            index={wi + 1}
                            active={dragInsertIdx === wi + 1}
                            onHover={() => setDragInsertIdx(wi + 1)}
                            onClick={(e) => { e.stopPropagation(); onMoveWordsHere?.(subtitle.id, wi + 1); }}
                            onDragOver={() => setDragInsertIdx(wi + 1)}
                            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); onWordDrop?.(subtitle.id, JSON.parse(e.dataTransfer.getData("text/plain")), wi + 1); setDragInsertIdx(null); setIsDragOver(false); }}
                          />
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className="text-xs text-green-600 dark:text-green-400 italic">
                      {t("editor:emptyWordsHint")}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <ActionButton
            icon={<Scissors size={13} />}
            title={t("editor:actions.split")}
            onClick={() => onSplit(subtitle.id)}
          />
          <ActionButton
            icon={<ChevronUp size={13} />}
            title={t("editor:actions.mergeUp")}
            onClick={() => onMergeUp(subtitle.id)}
            disabled={isFirst}
          />
          <ActionButton
            icon={<ChevronDown size={13} />}
            title={t("editor:actions.mergeDown")}
            onClick={() => onMergeDown(subtitle.id)}
            disabled={isLast}
          />
          <ActionButton
            icon={<Trash2 size={13} />}
            title={t("editor:actions.delete")}
            onClick={() => onDelete(subtitle.id)}
            danger
          />
        </div>
      </div>
    </div>
  );
}

function TimestampInput({
  value,
  onChange,
  onClick,
}: {
  value: string;
  onChange: (v: string) => void;
  onClick: () => void;
}) {
  const { t } = useTranslation(["editor"]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  if (editing) {
    return (
      <input
        className="timestamp-input w-[7.5rem] rounded border border-blue-300 dark:border-blue-600 bg-white dark:bg-gray-800 px-1.5 py-0.5 text-gray-800 dark:text-gray-200 focus:outline-none"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          onChange(draft);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onChange(draft);
            setEditing(false);
          }
          if (e.key === "Escape") setEditing(false);
        }}
        autoFocus
      />
    );
  }

  return (
    <button
      className="timestamp-input w-[7.5rem] rounded px-1.5 py-0.5 text-left text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
      onClick={onClick}
      onDoubleClick={() => setEditing(true)}
      title={t("editor:timestampHint")}
    >
      {value}
    </button>
  );
}

function ActionButton({
  icon,
  title,
  onClick,
  disabled,
  danger,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded p-1 transition-colors disabled:opacity-20 disabled:cursor-not-allowed ${
        danger
          ? "text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600"
          : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-200"
      }`}
    >
      {icon}
    </button>
  );
}

const SPEAKER_COLORS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
];

function InsertionZone({
  index,
  active,
  onHover,
  onClick,
  onDragOver,
  onDrop,
}: {
  index: number;
  active: boolean;
  onHover: () => void;
  onClick: (e: React.MouseEvent) => void;
  onDragOver: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const { t } = useTranslation(["editor"]);
  return (
    <button
      className={`mx-0.5 h-5 w-3 flex items-center justify-center rounded transition-all shrink-0 ${
        active
          ? "bg-green-300 dark:bg-green-600 w-4"
          : "hover:bg-green-200 dark:hover:bg-green-800"
      }`}
      title={t("editor:insertHere", { index })}
      onMouseEnter={onHover}
      onClick={onClick}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOver(); }}
      onDrop={onDrop}
    >
      <span
        className={`rounded-full transition-all ${
          active
            ? "w-0.5 h-4 bg-green-600 dark:bg-green-300"
            : "w-0.5 h-3 bg-green-400 dark:bg-green-500"
        }`}
      />
    </button>
  );
}

function SpeakerBadge({ speaker }: { speaker: string }) {
  const num = parseInt(speaker.replace(/\D/g, ""), 10) || 1;
  const colorClass = SPEAKER_COLORS[(num - 1) % SPEAKER_COLORS.length];
  return (
    <span
      className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${colorClass}`}
      title={speaker}
    >
      S{num}
    </span>
  );
}
