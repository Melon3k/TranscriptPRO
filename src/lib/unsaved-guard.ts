import { ask } from "@tauri-apps/plugin-dialog";
import i18n from "../i18n";
import { useSubtitleStore } from "../stores/subtitleStore";

/**
 * Guard against silent data loss when a document is about to be REPLACED
 * (opening a file, a recent entry, a drop, or restoring a version). The
 * dirty-close guard only covers window close/quit — an in-app swap would
 * otherwise overwrite unsaved edits without asking.
 *
 * Returns true when it's safe to proceed: either there are no unsaved edits, or
 * the user confirmed discarding them. Reads `dirty` from the live store so
 * callers don't need to subscribe.
 */
export async function confirmDiscardIfDirty(): Promise<boolean> {
  if (!useSubtitleStore.getState().dirty) return true;
  return ask(i18n.t("common:unsavedDiscard"), {
    title: i18n.t("common:unsavedTitle"),
    kind: "warning",
  });
}
