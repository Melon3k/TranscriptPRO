import { hasApiKey, setApiKey } from "./tauri-commands";
import { pendingKeyMigrations, useSettingsStore } from "../stores/settingsStore";

/**
 * Startup init for API keys. Two jobs:
 *
 * 1. Migration: pre-keychain installs persisted plaintext keys in localStorage.
 *    The settings-store migration extracted them into `pendingKeyMigrations`
 *    (localStorage itself is already scrubbed by then) — push them into the OS
 *    credential store now.
 * 2. Load key-presence flags into the settings store so the UI can gate
 *    translation without ever seeing the keys.
 */
export async function initApiKeys(): Promise<void> {
  // Drain the stash first so a failed push is retried at most once per launch.
  const pending = pendingKeyMigrations.splice(0);
  for (const { provider, key } of pending) {
    try {
      await setApiKey(provider, key);
    } catch (e) {
      // The plaintext copy is gone; worst case the user re-enters the key.
      console.error(`Migrating ${provider} API key to the keychain failed:`, e);
    }
  }

  const { setKeyPresence } = useSettingsStore.getState();
  const [gemini, claude] = await Promise.all([
    hasApiKey("gemini").catch(() => false),
    hasApiKey("claude").catch(() => false),
  ]);
  setKeyPresence("gemini", gemini);
  setKeyPresence("claude", claude);
}
