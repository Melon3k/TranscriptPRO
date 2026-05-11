import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useUpdateStore } from "../stores/updateStore";

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
    await relaunch();
  } catch (e) {
    store.setError(e instanceof Error ? e.message : String(e));
  }
}

export { relaunch };
