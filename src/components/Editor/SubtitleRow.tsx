import { useState, useRef, useEffect } from "react";
import { Scissors, ChevronUp, ChevronDown, Trash2 } from "lucide-react";
import { Subtitle } from "../../types/subtitle";
import { formatTimestamp, parseTimestamp } from "../../lib/time-format";

interface SubtitleRowProps {
  subtitle: Subtitle;
  isActive: boolean;
  activeWordIndex: number | null;
  onUpdate: (id: string, changes: Partial<Subtitle>) => void;
  onSplit: (id: string) => void;
  onMergeUp: (id: string) => void;
  onMergeDown: (id: string) => void;
  onDelete: (id: string) => void;
  onSeek: (ms: number) => void;
  isFirst: boolean;
  isLast: boolean;
}

export default function SubtitleRow({
  subtitle,
  isActive,
  activeWordIndex,
  onUpdate,
  onSplit,
  onMergeUp,
  onMergeDown,
  onDelete,
  onSeek,
  isFirst,
  isLast,
}: SubtitleRowProps) {
  const [editing, setEditing] = useState(false);
  const [editingText, setEditingText] = useState(subtitle.text);
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

  return (
    <div
      className={`group rounded-lg border px-3 py-2 transition-colors ${
        isActive
          ? "border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20"
          : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
      }`}
    >
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
              title="Double-click to edit text"
            >
              {/* Sentence text */}
              <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200">
                {subtitle.text}
              </p>

              {/* Clickable words */}
              {hasWords && (
                <div className="flex flex-wrap gap-x-1 gap-y-0.5 mt-1.5">
                  {subtitle.words.map((word, wi) => (
                    <button
                      key={wi}
                      onClick={() => onSeek(word.startTime)}
                      className={`text-xs px-1 py-0.5 rounded transition-colors ${
                        activeWordIndex === wi
                          ? "bg-blue-200 dark:bg-blue-700 text-blue-800 dark:text-blue-100 font-medium"
                          : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200"
                      }`}
                      title={`${formatTimestamp(word.startTime)} \u2192 ${formatTimestamp(word.endTime)}`}
                    >
                      {word.text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <ActionButton
            icon={<Scissors size={13} />}
            title="Split"
            onClick={() => onSplit(subtitle.id)}
          />
          <ActionButton
            icon={<ChevronUp size={13} />}
            title="Merge up"
            onClick={() => onMergeUp(subtitle.id)}
            disabled={isFirst}
          />
          <ActionButton
            icon={<ChevronDown size={13} />}
            title="Merge down"
            onClick={() => onMergeDown(subtitle.id)}
            disabled={isLast}
          />
          <ActionButton
            icon={<Trash2 size={13} />}
            title="Delete"
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
      title="Click to seek, double-click to edit"
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
