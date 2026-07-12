import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";
import i18n from "../i18n";
import { useUpdateStore } from "../stores/updateStore";
import { useSubtitleStore } from "../stores/subtitleStore";
import { setDirty } from "./tauri-commands";

export async function checkForUpdates(opts: { silent?: boolean } = {}): Promise<Update | null> {
  const store = useUpdateStore.getState();
  store.setChecking();
  try {
    const update = await check();
    if (!update?.available) {
      store.setUpToDate();
      return null;
    }
    if (opts.silent && update.version === store.dismissedVersion) {
      return null;
    }
    store.setAvailable(update);
    return update;
  } catch (e) {
    store.setError(e instanceof Error ? e.message : String(e));
    return null;
  }
}

export async function installCurrentUpdate(): Promise<void> {
  const store = useUpdateStore.getState();
  const update = store.update;
  if (!update) return;

  // Installing restarts the app, discarding in-memory edits — confirm first if dirty.
  if (useSubtitleStore.getState().dirty) {
    const confirmed = await ask(i18n.t("common:unsavedUpdate"), {
      title: i18n.t("common:unsavedTitle"),
      kind: "warning",
    });
    if (!confirmed) return;
  }

  try {
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          store.setDownloading(event.data.contentLength ?? null);
          break;
        case "Progress":
          store.addProgress(event.data.chunkLength);
          break;
        case "Finished":
          store.setInstalling();
          break;
      }
    });
    store.setDone();
    // The user already confirmed above (if dirty). Clear both the store flag and the native
    // mirror so they stay in sync (even if relaunch throws) and the ExitRequested handler
    // doesn't prevent the relaunch and re-prompt.
    useSubtitleStore.getState().markSaved();
    await setDirty(false);
    await relaunch();
  } catch (e) {
    store.setError(e instanceof Error ? e.message : String(e));
  }
}

export { relaunch };
