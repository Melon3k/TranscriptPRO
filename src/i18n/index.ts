import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import plCommon from "./locales/pl/common.json";
import plSettings from "./locales/pl/settings.json";
import plUpdate from "./locales/pl/update.json";
import plToolbar from "./locales/pl/toolbar.json";
import plTranscription from "./locales/pl/transcription.json";
import plTranslation from "./locales/pl/translation.json";
import plHistory from "./locales/pl/history.json";
import plEditor from "./locales/pl/editor.json";
import plPlayer from "./locales/pl/player.json";
import plLogPanel from "./locales/pl/logPanel.json";
import plErrors from "./locales/pl/errors.json";
import plOnboarding from "./locales/pl/onboarding.json";
import plShortcuts from "./locales/pl/shortcuts.json";
import plOpen from "./locales/pl/open.json";
import plStyle from "./locales/pl/style.json";

import enCommon from "./locales/en/common.json";
import enSettings from "./locales/en/settings.json";
import enUpdate from "./locales/en/update.json";
import enToolbar from "./locales/en/toolbar.json";
import enTranscription from "./locales/en/transcription.json";
import enTranslation from "./locales/en/translation.json";
import enHistory from "./locales/en/history.json";
import enEditor from "./locales/en/editor.json";
import enPlayer from "./locales/en/player.json";
import enLogPanel from "./locales/en/logPanel.json";
import enErrors from "./locales/en/errors.json";
import enOnboarding from "./locales/en/onboarding.json";
import enShortcuts from "./locales/en/shortcuts.json";
import enOpen from "./locales/en/open.json";
import enStyle from "./locales/en/style.json";

export const SUPPORTED_LANGUAGES = ["pl", "en"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const resources = {
  pl: {
    common: plCommon,
    settings: plSettings,
    update: plUpdate,
    toolbar: plToolbar,
    transcription: plTranscription,
    translation: plTranslation,
    history: plHistory,
    editor: plEditor,
    player: plPlayer,
    logPanel: plLogPanel,
    errors: plErrors,
    onboarding: plOnboarding,
    shortcuts: plShortcuts,
    open: plOpen,
    style: plStyle,
  },
  en: {
    common: enCommon,
    settings: enSettings,
    update: enUpdate,
    toolbar: enToolbar,
    transcription: enTranscription,
    translation: enTranslation,
    history: enHistory,
    editor: enEditor,
    player: enPlayer,
    logPanel: enLogPanel,
    errors: enErrors,
    onboarding: enOnboarding,
    shortcuts: enShortcuts,
    open: enOpen,
    style: enStyle,
  },
} as const;

// settingsStore is the source of truth for the chosen language. Detector is
// only used on the very first run (no value in localStorage yet) — order
// matters: settingsStore first, then navigator.language fallback.
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "pl",
    supportedLngs: SUPPORTED_LANGUAGES,
    defaultNS: "common",
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "transcriptpro-i18n-language",
      caches: ["localStorage"],
    },
    returnNull: false,
  });

export default i18n;
