import { useEffect } from "react";
import { useSettingsStore } from "./stores/settingsStore";
import MainLayout from "./components/Layout/MainLayout";
import UpdateToast from "./components/UpdateToast";
import { startUpdateScheduler } from "./lib/update-scheduler";

function App() {
  const { darkMode } = useSettingsStore();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

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
