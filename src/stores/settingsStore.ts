import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TranslationProvider } from "../types/subtitle";

export type UiLanguage = "pl" | "en";

interface SettingsState {
  whisperModel: string;
  translationProvider: TranslationProvider;
  // Presence of API keys in the OS credential store. Not persisted — loaded at
  // startup and updated when a key is saved/removed; the keys themselves never
  // reach the frontend.
  hasGeminiKey: boolean;
  hasClaudeKey: boolean;
  geminiModel: string;
  darkMode: boolean;
  autoSaveOnTranscription: boolean;
  autoSaveOnTranslation: boolean;
  autoSaveOnImport: boolean;
  autoCheckUpdates: boolean;
  language: UiLanguage;
  forceCpu: boolean;

  setWhisperModel: (model: string) => void;
  setTranslationProvider: (provider: TranslationProvider) => void;
  setKeyPresence: (provider: "gemini" | "claude", present: boolean) => void;
  setGeminiModel: (model: string) => void;
  toggleDarkMode: () => void;
  setAutoSaveOnTranscription: (v: boolean) => void;
  setAutoSaveOnTranslation: (v: boolean) => void;
  setAutoSaveOnImport: (v: boolean) => void;
  setAutoCheckUpdates: (v: boolean) => void;
  setLanguage: (lang: UiLanguage) => void;
  setForceCpu: (v: boolean) => void;
}

function detectInitialLanguage(): UiLanguage {
  // Persisted value wins (handled by zustand persist middleware after rehydrate).
  // For the very first run we look at navigator.language so PL users start in PL
  // and everyone else gets EN.
  if (typeof navigator === "undefined") return "pl";
  return navigator.language?.toLowerCase().startsWith("pl") ? "pl" : "en";
}

/// Plaintext API keys found in localStorage during store migration, waiting to be
/// pushed into the OS credential store by initApiKeys(). Migration must extract
/// them synchronously: right after `migrate` returns, persist rewrites localStorage
/// through `partialize`, which scrubs the legacy plaintext fields.
export const pendingKeyMigrations: {
  provider: "gemini" | "claude";
  key: string;
}[] = [];

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      whisperModel: "small",
      translationProvider: "gemini",
      hasGeminiKey: false,
      hasClaudeKey: false,
      geminiModel: "gemini-3.1-flash-lite",
      darkMode: false,
      autoSaveOnTranscription: true,
      autoSaveOnTranslation: true,
      autoSaveOnImport: true,
      autoCheckUpdates: true,
      language: detectInitialLanguage(),
      forceCpu: false,

      setWhisperModel: (model) => set({ whisperModel: model }),
      setTranslationProvider: (provider) =>
        set({ translationProvider: provider }),
      setKeyPresence: (provider, present) =>
        set(provider === "gemini" ? { hasGeminiKey: present } : { hasClaudeKey: present }),
      setGeminiModel: (model) => set({ geminiModel: model }),
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
      setAutoSaveOnTranscription: (v) => set({ autoSaveOnTranscription: v }),
      setAutoSaveOnTranslation: (v) => set({ autoSaveOnTranslation: v }),
      setAutoSaveOnImport: (v) => set({ autoSaveOnImport: v }),
      setAutoCheckUpdates: (v) => set({ autoCheckUpdates: v }),
      setLanguage: (lang) => set({ language: lang }),
      setForceCpu: (v) => set({ forceCpu: v }),
    }),
    {
      name: "transcriptpro-settings",
      version: 4,
      migrate: (persisted) => {
        const state = persisted as Record<string, unknown>;
        // v0 → v1: LibreTranslate was dropped as a provider (public server went paid).
        if (state.translationProvider === "libretranslate") {
          state.translationProvider = "gemini";
        }
        // v1 → v2: API keys moved from localStorage to the OS credential store.
        // Tauri commands are async and can't be awaited here, so stash the keys
        // for initApiKeys() to push right after startup.
        for (const [provider, field] of [
          ["gemini", "geminiApiKey"],
          ["claude", "claudeApiKey"],
        ] as const) {
          const key = state[field];
          if (typeof key === "string" && key.trim()) {
            pendingKeyMigrations.push({ provider, key: key.trim() });
          }
        }
        // v2 → v4: Google retired the 1.5/2.0 Gemini models (404 / free-tier
        // limit 0) and closed the 2.5-flash tier to new API users ("no longer
        // available to new users") — reset any stale choice to the current default.
        const validGeminiModels = [
          "gemini-3.1-flash-lite",
          "gemini-3.5-flash",
          "gemini-2.5-pro",
        ];
        if (
          typeof state.geminiModel !== "string" ||
          !validGeminiModels.includes(state.geminiModel)
        ) {
          state.geminiModel = "gemini-3.1-flash-lite";
        }
        return state;
      },
      partialize: (state) => {
        // Key-presence flags mirror the OS credential store, so they must not be
        // persisted. Destructuring the legacy fields out also scrubs plaintext
        // API keys that pre-keychain installs merged in from localStorage.
        const {
          hasGeminiKey: _presenceGemini,
          hasClaudeKey: _presenceClaude,
          geminiApiKey: _legacyGemini,
          claudeApiKey: _legacyClaude,
          libreTranslateApiKey: _legacyLibreKey,
          libreTranslateUrl: _legacyLibreUrl,
          ...rest
        } = state as SettingsState & Record<string, unknown>;
        return rest;
      },
    }
  )
);
