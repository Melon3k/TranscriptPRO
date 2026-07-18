import { useState, type CSSProperties } from "react";
import { Sparkles, Layers, ChevronDown, Lock, Search, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { COLORS, f, FONTS, tabStyle, sectionLabel, toggle } from "../../lib/ui";

type StyleTab = "inspector" | "anim" | "effects";

/**
 * Caption STYLING workspace. Subtitle styling, animations and presets are part
 * of the new design but not implemented yet, so this whole panel is rendered
 * disabled/grayed (per the brief: build the UI, gray it out, add no behaviour).
 */
export default function StylePanel() {
  const { t } = useTranslation(["style"]);
  const [tab, setTab] = useState<StyleTab>("inspector");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--c-border)", padding: "0 8px" }}>
        <button onClick={() => setTab("inspector")} style={{ ...tabStyle(tab === "inspector"), background: "none", border: "none", borderBottom: tabStyle(tab === "inspector").borderBottom }}>
          {t("style:tabs.inspector")}
        </button>
        <button onClick={() => setTab("anim")} style={{ ...tabStyle(tab === "anim"), background: "none", border: "none", borderBottom: tabStyle(tab === "anim").borderBottom }}>
          <Sparkles size={12} />
          {t("style:tabs.animations")}
        </button>
        <button onClick={() => setTab("effects")} style={{ ...tabStyle(tab === "effects"), background: "none", border: "none", borderBottom: tabStyle(tab === "effects").borderBottom }}>
          <Layers size={12} />
          {t("style:tabs.effects")}
        </button>
      </div>

      {/* Disabled notice */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          margin: "12px 14px 0",
          padding: "9px 11px",
          background: "rgba(245,165,36,.1)",
          border: `1px solid ${COLORS.amber}55`,
          borderRadius: 8,
        }}
      >
        <Lock size={13} color={COLORS.amber} />
        <span style={f(600, 10, "body", { color: COLORS.amber, lineHeight: 1.4 })}>{t("style:comingSoon")}</span>
      </div>

      {/* Grayed, non-interactive preview of the intended controls */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16, opacity: 0.45, pointerEvents: "none", userSelect: "none" }}>
        {tab === "inspector" && <Inspector t={t} />}
        {tab === "anim" && <Animations t={t} />}
        {tab === "effects" && <Effects t={t} />}
      </div>
    </div>
  );
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function Inspector({ t }: { t: TFn }) {
  const tg = toggle(true);
  const tgOff = toggle(false);
  return (
    <>
      <div style={sectionLabel}>{t("style:text")}</div>
      <div style={{ ...fieldRow, marginBottom: 12 }}>
        <span style={f(600, 12, "display")}>Outfit</span>
        <ChevronDown size={13} color="var(--c-muted)" />
      </div>
      <SliderRow label={t("style:size")} value="48 px" />
      <div style={{ display: "flex", gap: 6, margin: "0 0 12px" }}>
        {["L", "C", "R"].map((a, i) => (
          <div key={a} style={iconBtn(i === 1)}>{a}</div>
        ))}
        <div style={{ width: 1, background: "var(--c-border)", margin: "0 2px" }} />
        <div style={iconBtn(true)}>B</div>
        <div style={iconBtn(false)}><span style={{ fontStyle: "italic" }}>I</span></div>
        <div style={iconBtn(false)}>TT</div>
      </div>
      <SliderRow label={t("style:letterSpacing")} value="0 px" />
      <SliderRow label={t("style:lineHeight")} value="1.15" />
      <div style={{ ...sectionLabel, marginTop: 6 }}>{t("style:outlineShadowGlow")}</div>
      {[
        [t("style:outline"), tg] as const,
        [t("style:shadow"), tgOff] as const,
        [t("style:glow"), tg] as const,
      ].map(([label, sw], i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 11 }}>
          <div style={sw.track}><span style={sw.knob} /></div>
          <span style={f(500, 11, "body", { color: "var(--c-text)" })}>{label}</span>
        </div>
      ))}
      <SliderRow label={t("style:glowStrength")} value="12" />
      <div style={sectionLabel}>{t("style:captionBox")}</div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gridTemplateRows: "repeat(3,20px)", gap: 4, width: 76 }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 5, border: `1px solid ${i === 7 ? COLORS.blue : "var(--c-border)"}`, background: i === 7 ? "rgba(37,99,255,.16)" : "var(--c-input)" }}>
              <span style={{ width: 6, height: 6, borderRadius: 2, background: i === 7 ? COLORS.blue : "var(--c-muted)" }} />
            </div>
          ))}
        </div>
        <div style={f(400, 10, "body", { flex: 1, color: "var(--c-text2)", lineHeight: 1.5 })}>
          {t("style:boxPosition")}<br />
          <span style={{ color: "var(--c-text)", fontWeight: 600 }}>{t("style:boxBottomCenter")}</span>
        </div>
      </div>
      <SliderRow label={t("style:width")} value="62%" />
      <SliderRow label={t("style:bottomDistance")} value="8%" />
    </>
  );
}

function Animations({ t }: { t: TFn }) {
  const anims = ["Fade in", "Slide up", "Pop", "Typewriter", "Karaoke", "Blur in"];
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <div style={{ ...pill, flex: 1, justifyContent: "center", background: "rgba(124,58,237,.16)", border: `1px solid ${COLORS.violet}`, color: "#c4b5fd" }}>
          {t("style:applyToSelected")}
        </div>
        <div style={{ ...pill, background: "var(--c-raised)", border: "1px solid var(--c-border)", color: "var(--c-text2)" }}>
          {t("style:applyToAll")}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {anims.map((name, i) => (
          <div key={name} style={{ border: `1px solid ${i === 0 ? COLORS.violet : "var(--c-border)"}`, borderRadius: 8, overflow: "hidden", background: "#0c1017" }}>
            <div style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 14, color: "#fff", WebkitTextStroke: "0.5px #0D1117" }}>Aa</span>
            </div>
            <div style={{ ...f(600, 9), padding: "5px 8px", borderTop: "1px solid var(--c-border)", color: "var(--c-text)" }}>{name}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function Effects({ t }: { t: TFn }) {
  const presets = ["Neon cyan", "Twardy cień", "Gruby obrys", "Miękki"];
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 9px", background: "var(--c-input)", border: "1px solid var(--c-border)", borderRadius: 7, color: "var(--c-muted)" }}>
          <Search size={12} />
          <span style={f(400, 10)}>{t("style:searchPreset")}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", background: "rgba(37,99,255,.14)", border: `1px solid ${COLORS.blue}`, borderRadius: 7, color: COLORS.blueLight, ...f(600, 10) }}>
          <Plus size={12} />
          {t("style:newPreset")}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
        {presets.map((name, i) => (
          <div key={name} style={{ border: `1px solid ${i === 0 ? COLORS.cyan : "var(--c-border)"}`, borderRadius: 9, overflow: "hidden", background: "#0c1017" }}>
            <div style={{ height: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontFamily: FONTS.display, fontWeight: 900, fontSize: 15, color: i === 0 ? "#fff" : COLORS.amber, textShadow: i === 0 ? `0 0 10px ${COLORS.cyan}` : "none" }}>Aa</span>
            </div>
            <div style={{ ...f(600, 9), padding: "5px 8px", borderTop: "1px solid var(--c-border)", color: "var(--c-text)" }}>{name}</div>
          </div>
        ))}
      </div>
    </>
  );
}

const fieldRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  height: 32,
  padding: "0 10px",
  background: "var(--c-input)",
  border: "1px solid var(--c-border)",
  borderRadius: 7,
};

const pill: CSSProperties = {
  height: 28,
  padding: "0 11px",
  display: "flex",
  alignItems: "center",
  borderRadius: 7,
  ...f(600, 10),
};

function iconBtn(on: boolean): CSSProperties {
  return {
    width: 30,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    border: `1px solid ${on ? COLORS.blue : "var(--c-border)"}`,
    background: on ? "rgba(37,99,255,.16)" : "var(--c-raised)",
    color: on ? COLORS.blueLight : "var(--c-text2)",
    fontFamily: FONTS.display,
    fontWeight: 700,
    fontSize: 12,
  };
}

function SliderRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, ...f(400, 10, "body", { color: "var(--c-text2)" }) }}>
        <span>{label}</span>
        <span style={{ fontFamily: FONTS.mono, fontWeight: 600, fontSize: 10, color: "var(--c-text)" }}>{value}</span>
      </div>
      <input type="range" disabled defaultValue={50} style={{ width: "100%", marginBottom: 12 }} />
    </>
  );
}
