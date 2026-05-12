import { useState } from "react";
import { Download, X, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUpdateStore } from "../stores/updateStore";
import { installCurrentUpdate, checkForUpdates } from "../lib/updater";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function UpdateToast() {
  const { t } = useTranslation(["update", "common"]);
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const notes = useUpdateStore((s) => s.notes);
  const downloaded = useUpdateStore((s) => s.downloaded);
  const contentLength = useUpdateStore((s) => s.contentLength);
  const error = useUpdateStore((s) => s.error);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const reset = useUpdateStore((s) => s.reset);

  const [showDetails, setShowDetails] = useState(false);

  const visible =
    status === "available" ||
    status === "downloading" ||
    status === "installing" ||
    status === "error" ||
    status === "done";

  if (!visible) return null;

  const busy = status === "downloading" || status === "installing";
  const progressPct =
    contentLength && contentLength > 0
      ? Math.min(100, Math.round((downloaded / contentLength) * 100))
      : null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[360px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl animate-in slide-in-from-bottom-4">
      <div className="flex items-start justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          {status === "error" ? (
            <AlertTriangle size={16} className="text-amber-500" />
          ) : status === "done" ? (
            <CheckCircle2 size={16} className="text-green-500" />
          ) : (
            <Download size={16} className="text-blue-500" />
          )}
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
            {status === "error"
              ? t("update:error")
              : status === "done"
              ? t("update:ready")
              : status === "installing"
              ? t("update:installing")
              : status === "downloading"
              ? t("update:downloading", { version })
              : t("update:available", { version })}
          </h3>
        </div>
        {!busy && (
          <button
            onClick={status === "error" ? reset : dismiss}
            aria-label={t("common:close")}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="px-4 pb-3 space-y-2.5">
        {status === "available" && (
          <>
            {notes && (
              <div className="text-xs text-gray-600 dark:text-gray-300">
                <div className={showDetails ? "whitespace-pre-wrap" : "line-clamp-2"}>
                  {notes}
                </div>
                {notes.length > 80 && (
                  <button
                    onClick={() => setShowDetails((v) => !v)}
                    className="mt-1 text-blue-500 hover:underline"
                  >
                    {showDetails ? t("update:hideDetails") : t("update:showDetails")}
                  </button>
                )}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => void installCurrentUpdate()}
                className="flex-1 rounded-md bg-blue-500 hover:bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors"
              >
                {t("update:installNow")}
              </button>
              <button
                onClick={dismiss}
                className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {t("update:later")}
              </button>
            </div>
          </>
        )}

        {status === "downloading" && (
          <>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${progressPct ?? 0}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {progressPct !== null
                ? t("update:downloadedOf", {
                    percent: progressPct,
                    downloaded: formatBytes(downloaded),
                    total: formatBytes(contentLength!),
                  })
                : t("update:downloadedBytes", { downloaded: formatBytes(downloaded) })}
            </p>
          </>
        )}

        {status === "installing" && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("update:willRestart")}
          </p>
        )}

        {status === "done" && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("update:restarting")}
          </p>
        )}

        {status === "error" && (
          <>
            <p className="text-xs text-amber-700 dark:text-amber-300">{error}</p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => void checkForUpdates()}
                className="flex-1 rounded-md bg-blue-500 hover:bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <RefreshCw size={12} />
                {t("update:tryAgain")}
              </button>
              <button
                onClick={reset}
                className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {t("common:close")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
