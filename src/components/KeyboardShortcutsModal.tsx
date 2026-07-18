import { Keyboard, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SHORTCUTS, type Shortcut } from "../lib/keyboard-shortcuts";
import { COLORS, f, FONTS, scrim, modalCard, sectionLabel } from "../lib/ui";

interface Props {
  open: boolean;
  onClose: () => void;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/.test(navigator.platform);

export default function KeyboardShortcutsModal({ open, onClose }: Props) {
  const { t } = useTranslation(["shortcuts", "common"]);
  if (!open) return null;

  const mod = isMac ? "⌘" : "Ctrl";
  const keysFor = (s: Shortcut) => {
    const keys: string[] = [];
    if (s.mod) keys.push(mod);
    if (s.shift) keys.push("⇧");
    keys.push(s.key);
    return keys;
  };
  const groups: { title: string; items: Shortcut[] }[] = [
    { title: t("shortcuts:global"), items: SHORTCUTS.filter((s) => s.scope === "global") },
    { title: t("shortcuts:editor"), items: SHORTCUTS.filter((s) => s.scope === "editor") },
  ].filter((g) => g.items.length > 0);

  return (
    <div style={scrim} onClick={onClose}>
      <div style={modalCard(480)} onClick={(e) => e.stopPropagation()}>
        <ModalHeader icon={<Keyboard size={17} color={COLORS.blueLight} />} title={t("shortcuts:title")} onClose={onClose} />
        <div style={{ padding: "16px 20px 20px" }}>
          {groups.map((g) => (
            <div key={g.title}>
              <div style={{ ...sectionLabel, margin: "6px 0 8px" }}>{g.title}</div>
              <div style={{ display: "flex", flexDirection: "column", marginBottom: 14 }}>
                {g.items.map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--c-border)" }}>
                    <span style={f(400, 12, "body", { color: "var(--c-text)" })}>{t(s.descriptionKey)}</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      {keysFor(s).map((k, j) => (
                        <span
                          key={j}
                          style={{
                            minWidth: 18, height: 22, padding: "0 7px", display: "flex", alignItems: "center", justifyContent: "center",
                            background: "var(--c-input)", border: "1px solid var(--c-border)", borderBottomWidth: 2, borderRadius: 5,
                            fontFamily: FONTS.mono, fontWeight: 600, fontSize: 11, color: "var(--c-text2)",
                          }}
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ModalHeader({ icon, title, onClose }: { icon: React.ReactNode; title: string; onClose: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: "1px solid var(--c-border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        {icon}
        <span style={f(600, 16, "display", { color: "var(--c-text)" })}>{title}</span>
      </div>
      <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--c-muted)", display: "flex", padding: 0 }}>
        <X size={17} />
      </button>
    </div>
  );
}
