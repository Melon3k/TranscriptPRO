import { useEffect } from "react";
import { useSettingsStore } from "./stores/settingsStore";
import MainLayout from "./components/Layout/MainLayout";

function App() {
  const { darkMode } = useSettingsStore();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return <MainLayout />;
}

export default App;
