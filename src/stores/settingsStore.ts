import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TranslationProvider } from "../types/subtitle";

interface SettingsState {
  whisperModel: string;
  translationProvider: TranslationProvider;
  deeplApiKey: string;
  googleApiKey: string;
  darkMode: boolean;

  setWhisperModel: (model: string) => void;
  setTranslationProvider: (provider: TranslationProvider) => void;
  setDeeplApiKey: (key: string) => void;
  setGoogleApiKey: (key: string) => void;
  toggleDarkMode: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      whisperModel: "small",
      translationProvider: "deepl",
      deeplApiKey: "",
      googleApiKey: "",
      darkMode: false,

      setWhisperModel: (model) => set({ whisperModel: model }),
      setTranslationProvider: (provider) =>
        set({ translationProvider: provider }),
      setDeeplApiKey: (key) => set({ deeplApiKey: key }),
      setGoogleApiKey: (key) => set({ googleApiKey: key }),
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
    }),
    {
      name: "transcriptpro-settings",
    }
  )
);
