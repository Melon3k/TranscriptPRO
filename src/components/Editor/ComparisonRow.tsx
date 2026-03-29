import { Subtitle } from "../../types/subtitle";
import { formatTimestamp } from "../../lib/time-format";

interface ComparisonRowProps {
  original: Subtitle;
  translated: Subtitle;
  isActive: boolean;
}

export default function ComparisonRow({
  original,
  translated,
  isActive,
}: ComparisonRowProps) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 transition-colors ${
        isActive
          ? "border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-900/10"
          : "border-gray-200 dark:border-gray-700"
      }`}
    >
      <div className="flex gap-3">
        {/* Index + timestamps */}
        <div className="flex flex-col items-center justify-center w-10 shrink-0">
          <span className="text-xs font-mono text-gray-400 dark:text-gray-500">
            {original.index}
          </span>
          <span className="text-[9px] font-mono text-gray-300 dark:text-gray-600 mt-0.5">
            {formatTimestamp(original.startTime).slice(3)}
          </span>
        </div>

        {/* Original text */}
        <div className="flex-1 min-w-0 border-r border-gray-200 dark:border-gray-700 pr-3">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              Original
            </span>
          </div>
          <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400 italic">
            {original.text}
          </p>
        </div>

        {/* Translated text */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-blue-500 dark:text-blue-400">
              Translated
            </span>
          </div>
          <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200">
            {translated.text}
          </p>
        </div>
      </div>
    </div>
  );
}
