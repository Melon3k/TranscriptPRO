import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TranslationProvider } from "../types/subtitle";

interface SettingsState {
  whisperModel: string;
  translationProvider: TranslationProvider;
  geminiApiKey: string;
  claudeApiKey: string;
  geminiModel: string;
  darkMode: boolean;

  setWhisperModel: (model: string) => void;
  setTranslationProvider: (provider: TranslationProvider) => void;
  setGeminiApiKey: (key: string) => void;
  setClaudeApiKey: (key: string) => void;
  setGeminiModel: (model: string) => void;
  toggleDarkMode: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      whisperModel: "small",
      translationProvider: "gemini",
      geminiApiKey: "",
      claudeApiKey: "",
      geminiModel: "gemini-2.0-flash-lite",
      darkMode: false,

      setWhisperModel: (model) => set({ whisperModel: model }),
      setTranslationProvider: (provider) =>
        set({ translationProvider: provider }),
      setGeminiApiKey: (key) => set({ geminiApiKey: key }),
      setClaudeApiKey: (key) => set({ claudeApiKey: key }),
      setGeminiModel: (model) => set({ geminiModel: model }),
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
    }),
    {
      name: "transcriptpro-settings",
    }
  )
);
