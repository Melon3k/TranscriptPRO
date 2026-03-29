import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TranslationProvider } from "../types/subtitle";

interface SettingsState {
  whisperModel: string;
  translationProvider: TranslationProvider;
  geminiApiKey: string;
  claudeApiKey: string;
  darkMode: boolean;

  setWhisperModel: (model: string) => void;
  setTranslationProvider: (provider: TranslationProvider) => void;
  setGeminiApiKey: (key: string) => void;
  setClaudeApiKey: (key: string) => void;
  toggleDarkMode: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      whisperModel: "small",
      translationProvider: "gemini",
      geminiApiKey: "",
      claudeApiKey: "",
      darkMode: false,

      setWhisperModel: (model) => set({ whisperModel: model }),
      setTranslationProvider: (provider) =>
        set({ translationProvider: provider }),
      setGeminiApiKey: (key) => set({ geminiApiKey: key }),
      setClaudeApiKey: (key) => set({ claudeApiKey: key }),
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
    }),
    {
      name: "transcriptpro-settings",
    }
  )
);
