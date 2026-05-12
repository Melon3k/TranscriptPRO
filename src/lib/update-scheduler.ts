import { checkForUpdates } from "./updater";
import { useSettingsStore } from "../stores/settingsStore";

const INITIAL_DELAY_MS = 5_000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

let started = false;

export function startUpdateScheduler(): void {
  if (started) return;
  started = true;

  const tick = () => {
    if (useSettingsStore.getState().autoCheckUpdates) {
      void checkForUpdates({ silent: true });
    }
  };

  setTimeout(tick, INITIAL_DELAY_MS);
  setInterval(tick, INTERVAL_MS);
}
