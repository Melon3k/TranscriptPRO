import { useState } from "react";
import Toolbar from "./Toolbar";
import Player from "../Player/Player";
import SubtitleEditor from "../Editor/SubtitleEditor";
import TranscriptionPanel from "../Transcription/TranscriptionPanel";
import TranslationPanel from "../Translation/TranslationPanel";
import SettingsModal from "../Settings/SettingsModal";
import { Mic, Languages, X } from "lucide-react";

type SidePanel = "transcription" | "translation";

export default function MainLayout() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<SidePanel>("transcription");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex h-screen flex-col bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Toolbar */}
      <Toolbar
        onOpenSettings={() => setSettingsOpen(true)}
        onStartTranscription={(path) => {
          setAudioPath(path);
          setActivePanel("transcription");
          setError(null);
        }}
        onError={(msg) => setError(msg)}
      />

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 px-4 py-2 text-xs text-red-700 dark:text-red-300">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Editor + Player */}
        <div className="flex flex-1 flex-col min-w-0">
          <Player />
          <SubtitleEditor />
        </div>

        {/* Right: Side panel */}
        <div className="w-72 shrink-0 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col overflow-hidden">
          {/* Panel tabs */}
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            <PanelTab
              icon={<Mic size={14} />}
              label="Transcribe"
              active={activePanel === "transcription"}
              onClick={() => setActivePanel("transcription")}
            />
            <PanelTab
              icon={<Languages size={14} />}
              label="Translate"
              active={activePanel === "translation"}
              onClick={() => setActivePanel("translation")}
            />
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-y-auto">
            {activePanel === "transcription" && (
              <TranscriptionPanel audioPath={audioPath} />
            )}
            {activePanel === "translation" && <TranslationPanel />}
          </div>
        </div>
      </div>

      {/* Settings modal */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function PanelTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
        active
          ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-500"
          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
