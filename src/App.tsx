import { useEffect } from "react";
import { useSettingsStore } from "./stores/settingsStore";

// Phase 0 placeholder — MainLayout will replace this in Phase 2
function App() {
  const { darkMode } = useSettingsStore();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">TranscriptPRO</h1>
        <p className="text-lg text-gray-500 dark:text-gray-400">
          Subtitle editor with Whisper transcription
        </p>
        <div className="mt-8 inline-flex items-center gap-2 rounded-lg bg-green-100 dark:bg-green-900 px-4 py-2 text-green-800 dark:text-green-200 text-sm font-medium">
          <span className="h-2 w-2 rounded-full bg-green-500 inline-block"></span>
          Phase 0 complete — Tauri + React + Tailwind running
        </div>
      </div>
    </div>
  );
}

export default App;
