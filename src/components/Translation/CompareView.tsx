import { Columns2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSubtitleStore } from "../../stores/subtitleStore";
import { COLORS, f, FONTS } from "../../lib/ui";

/** Center-column side-by-side original ↔ translation table (comparison mode). */
export default function CompareView() {
  const { t } = useTranslation(["translation", "editor"]);
  const subtitles = useSubtitleStore((s) => s.subtitles);
  const originalSubtitles = useSubtitleStore((s) => s.originalSubtitles);
  const setComparisonMode = useSubtitleStore((s) => s.setComparisonMode);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          height: 42,
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 18px",
          borderBottom: "1px solid var(--c-border)",
        }}
      >
        <Columns2 size={16} color={COLORS.violetLight} />
        <span style={f(600, 13, "display")}>{t("translation:compareTitle")}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setComparisonMode(false)}
          style={{
            height: 28,
            padding: "0 12px",
            display: "flex",
            alignItems: "center",
            background: "var(--c-raised)",
            border: "1px solid var(--c-border)",
            borderRadius: 7,
            cursor: "pointer",
            ...f(600, 10, "body", { color: "var(--c-text2)" }),
          }}
        >
          {t("translation:hideComparison")}
        </button>
      </div>

      <div
        style={{
          height: 30,
          flex: "none",
          display: "flex",
          padding: "0 18px",
          alignItems: "center",
          background: "var(--c-panel)",
          borderBottom: "1px solid var(--c-border)",
          ...f(600, 9, "body", { letterSpacing: ".08em", color: "var(--c-muted)" }),
        }}
      >
        <span style={{ width: 70 }}>#</span>
        <span style={{ flex: 1 }}>{t("editor:comparison.original").toUpperCase()}</span>
        <span style={{ flex: 1 }}>{t("editor:comparison.translated").toUpperCase()}</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {subtitles.map((sub, i) => {
          const original = originalSubtitles?.[i];
          return (
            <div
              key={sub.id}
              style={{
                display: "flex",
                padding: "11px 18px",
                borderBottom: "1px solid var(--c-border)",
                alignItems: "flex-start",
              }}
            >
              <span style={{ width: 70, fontFamily: FONTS.mono, fontWeight: 600, fontSize: 9, color: "var(--c-muted)" }}>
                #{sub.index}
              </span>
              <span style={f(400, 12, "body", { flex: 1, fontStyle: "italic", color: "var(--c-muted)", lineHeight: 1.4, paddingRight: 16 })}>
                {original?.text ?? ""}
              </span>
              <span style={f(400, 12, "body", { flex: 1, color: "var(--c-text)", lineHeight: 1.4 })}>{sub.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
