import type { TFunction } from "i18next";

/**
 * Shape of `AppError` after Tauri IPC serialization (see src-tauri/src/subtitle/types.rs).
 * Frontend maps `code` to a translation key in the `errors` namespace.
 */
export interface AppErrorPayload {
  code: string;
  message: string;
  detail: string;
}

function isAppErrorPayload(value: unknown): value is AppErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof (value as { code: unknown }).code === "string"
  );
}

/**
 * Convert a thrown value from a Tauri command into a user-facing, localized string.
 * Falls back to the English message (or stringified value) when no translation exists.
 */
export function formatError(t: TFunction, err: unknown): string {
  if (isAppErrorPayload(err)) {
    return t(`errors:${err.code}`, {
      detail: err.detail,
      defaultValue: err.message,
    });
  }
  return String(err);
}

/** True when the error represents a user-initiated cancellation. */
export function isCancellation(err: unknown): boolean {
  if (isAppErrorPayload(err)) {
    return err.code === "CANCELLED";
  }
  return String(err).toLowerCase().includes("cancel");
}
