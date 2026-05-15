import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SHORTCUTS, type Shortcut } from "../lib/keyboard-shortcuts";

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPod|iPad/.test(navigator.platform);

function KeyChip({ label }: { label: string }) {
  return (
    <kbd className="inline-flex items-center justify-center rounded border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 text-[11px] font-mono text-gray-700 dark:text-gray-300 min-w-[1.4rem]">
      {label}
    </kbd>
  );
}

function ShortcutRow({ shortcut }: { shortcut: Shortcut }) {
  const { t } = useTranslation(["shortcuts"]);
  const mod = isMac ? "⌘" : "Ctrl";

  const keys: string[] = [];
  if (shortcut.mod) keys.push(mod);
  if (shortcut.shift) keys.push("⇧");
  keys.push(shortcut.key);

  return (
    <tr className="border-b border-gray-100 dark:border-gray-700 last:border-0">
      <td className="py-2 pr-4">
        <div className="flex items-center gap-1">
          {keys.map((k, i) => (
            <KeyChip key={i} label={k} />
          ))}
        </div>
      </td>
      <td className="py-2 text-sm text-gray-700 dark:text-gray-300">
        {t(shortcut.descriptionKey)}
      </td>
    </tr>
  );
}

export default function KeyboardShortcutsModal({
  open,
  onClose,
}: KeyboardShortcutsModalProps) {
  const { t } = useTranslation(["shortcuts", "common"]);

  if (!open) return null;

  const globalShortcuts = SHORTCUTS.filter((s) => s.scope === "global");
  const editorShortcuts = SHORTCUTS.filter((s) => s.scope === "editor");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white dark:bg-gray-800 shadow-2xl border border-gray-200 dark:border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t("shortcuts:title")}
          </h2>
          <button
            onClick={onClose}
            aria-label={t("common:close")}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Global shortcuts */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {t("shortcuts:global")}
            </p>
            <table className="w-full">
              <tbody>
                {globalShortcuts.map((s, i) => (
                  <ShortcutRow key={i} shortcut={s} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Editor shortcuts (only shown if any exist) */}
          {editorShortcuts.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                {t("shortcuts:editor")}
              </p>
              <table className="w-full">
                <tbody>
                  {editorShortcuts.map((s, i) => (
                    <ShortcutRow key={i} shortcut={s} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-5 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-blue-500 hover:bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors"
          >
            {t("common:close")}
          </button>
        </div>
      </div>
    </div>
  );
}
