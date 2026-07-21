import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Sun, Moon, Keyboard, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../../stores/settingsStore";
import { COLORS, f, FONTS } from "../../lib/ui";

interface TitleBarProps {
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
}

/**
 * App header: brand + version, theme toggle, shortcuts, settings.
 * The OS draws the real window controls (decorations are enabled), so unlike the
 * prototype mock this bar has no fake traffic-light dots.
 */
export default function TitleBar({ onOpenSettings, onOpenShortcuts }: TitleBarProps) {
  const { t } = useTranslation(["toolbar"]);
  const darkMode = useSettingsStore((s) => s.darkMode);
  const toggleDarkMode = useSettingsStore((s) => s.toggleDarkMode);
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  return (
    <div
      style={{
        height: 40,
        flex: "none",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 14px",
        background: "var(--c-title)",
        borderBottom: "1px solid var(--c-border)",
      }}
    >
      <span style={f(600, 13, "display")}>
        Transcript<span style={{ color: COLORS.blue }}>PRO</span>
      </span>
      {version && (
        <span style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: 10, color: "var(--c-muted)" }}>
          {version}
        </span>
      )}
      <div style={{ flex: 1 }} />
      <IconBtn
        title={darkMode ? t("toolbar:lightMode") : t("toolbar:darkMode")}
        onClick={toggleDarkMode}
      >
        {darkMode ? <Sun size={15} /> : <Moon size={15} />}
      </IconBtn>
      <IconBtn title={t("toolbar:shortcuts")} onClick={onOpenShortcuts}>
        <Keyboard size={15} />
      </IconBtn>
      <IconBtn title={t("toolbar:settings")} onClick={onOpenSettings}>
        <Settings size={15} />
      </IconBtn>
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={title}
      data-tip={title}
      style={{
        width: 30,
        height: 30,
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color: "var(--c-text2)",
        background: "none",
        border: "none",
      }}
    >
      {children}
    </button>
  );
}
