import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TranslationProvider } from "../types/subtitle";

interface SettingsState {
  whisperModel: string;
  translationProvider: TranslationProvider;
  geminiApiKey: string;
  claudeApiKey: string;
  geminiModel: string;
  libreTranslateUrl: string;
  libreTranslateApiKey: string;
  darkMode: boolean;

  setWhisperModel: (model: string) => void;
  setTranslationProvider: (provider: TranslationProvider) => void;
  setGeminiApiKey: (key: string) => void;
  setClaudeApiKey: (key: string) => void;
  setGeminiModel: (model: string) => void;
  setLibreTranslateUrl: (url: string) => void;
  setLibreTranslateApiKey: (key: string) => void;
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
      libreTranslateUrl: "https://libretranslate.com",
      libreTranslateApiKey: "",
      darkMode: false,

      setWhisperModel: (model) => set({ whisperModel: model }),
      setTranslationProvider: (provider) =>
        set({ translationProvider: provider }),
      setGeminiApiKey: (key) => set({ geminiApiKey: key }),
      setClaudeApiKey: (key) => set({ claudeApiKey: key }),
      setGeminiModel: (model) => set({ geminiModel: model }),
      setLibreTranslateUrl: (url) => set({ libreTranslateUrl: url }),
      setLibreTranslateApiKey: (key) => set({ libreTranslateApiKey: key }),
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
    }),
    {
      name: "transcriptpro-settings",
    }
  )
);
