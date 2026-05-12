import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "./stores/settingsStore";
import MainLayout from "./components/Layout/MainLayout";
import UpdateToast from "./components/UpdateToast";
import { startUpdateScheduler } from "./lib/update-scheduler";

function App() {
  const { darkMode, language } = useSettingsStore();
  const { i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  // settingsStore is the source of truth for UI language. Push changes into
  // i18next whenever it changes (also on first mount, in case the persisted
  // value differs from what the LanguageDetector picked).
  useEffect(() => {
    if (i18n.resolvedLanguage !== language) {
      void i18n.changeLanguage(language);
    }
  }, [i18n, language]);

  useEffect(() => {
    startUpdateScheduler();
  }, []);

  return (
    <>
      <MainLayout />
      <UpdateToast />
    </>
  );
}

export default App;
