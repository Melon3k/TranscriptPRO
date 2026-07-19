import { useState, type CSSProperties, type ReactNode } from "react";
import { Sparkles, Layers, ChevronDown, Lock, Search, Plus, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { COLORS, f, FONTS, tabStyle, sectionLabel, selectStyle, toggle } from "../../lib/ui";
import { useStyleStore } from "../../stores/styleStore";
import {
  BOX_GRID,
  CAPTION_FONTS,
  STYLE_LIMITS,
  normalizeHexColor,
  type NumericStyleField,
} from "../../lib/caption-style";
import type { CaptionAlign, CaptionFontId } from "../../types/captionStyle";

type StyleTab = "inspector" | "anim" | "effects";

/**
 * Caption STYLING workspace. The Inspector tab is live (item A) and edits the
 * global CaptionStyle in styleStore; Animations (item C) and Effects (item D)
 * are still non-interactive previews, kept grayed behind the lock notice.
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

      {tab === "inspector" ? (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <Inspector t={t} />
        </div>
      ) : (
        <>
          {/* Disabled notice — Animations/Effects only; the Inspector is live. */}
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
          <div style={{ flex: 1, overflowY: "auto", padding: 16, opacity: 0.45, pointerEvents: "none", userSelect: "none" }}>
            {tab === "anim" ? <Animations t={t} /> : <Effects t={t} />}
          </div>
        </>
      )}
    </div>
  );
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function Inspector({ t }: { t: TFn }) {
  const style = useStyleStore((s) => s.style);
  const setStyle = useStyleStore((s) => s.setStyle);
  const resetStyle = useStyleStore((s) => s.resetStyle);

  const setNum = (field: NumericStyleField) => (v: number) => setStyle({ [field]: v });
  // marginVPct anchors to whichever edge the box position selects; the middle
  // row ignores it entirely (captionBoxCss centers vertically), so hide it.
  const row: "top" | "middle" | "bottom" =
    style.boxPosition >= 7 ? "top" : style.boxPosition >= 4 ? "middle" : "bottom";

  return (
    <>
      <div style={sectionLabel}>{t("style:text")}</div>
      <div style={{ position: "relative", marginBottom: 12 }}>
        <select
          value={style.fontId}
          onChange={(e) => setStyle({ fontId: e.target.value as CaptionFontId })}
          style={{ ...selectStyle, fontFamily: FONTS.display, fontWeight: 600 }}
          aria-label={t("style:font")}
        >
          {Object.entries(CAPTION_FONTS).map(([id, font]) => (
            <option key={id} value={id}>
              {font.label}
            </option>
          ))}
        </select>
        <ChevronDown size={13} color="var(--c-muted)" style={{ position: "absolute", right: 10, top: 10, pointerEvents: "none" }} />
      </div>
      <StyleSlider label={t("style:size")} field="fontSize" value={style.fontSize} onChange={setNum("fontSize")} unit=" px" />
      <div style={{ display: "flex", gap: 6, margin: "0 0 12px", alignItems: "center" }}>
        {(["left", "center", "right"] as const).map((a) => (
          <IconBtn key={a} on={style.align === a} label={t(`style:align.${a}`)} onClick={() => setStyle({ align: a as CaptionAlign })}>
            {a === "left" ? "L" : a === "center" ? "C" : "R"}
          </IconBtn>
        ))}
        {/* align is preview-only: ASS ties justification to the numpad Alignment
            (driven by boxPosition), so ass.rs deliberately does not export it. */}
        <span style={f(600, 8, "body", { color: COLORS.amber, border: `1px solid ${COLORS.amber}55`, borderRadius: 4, padding: "1px 5px", letterSpacing: ".06em", textTransform: "uppercase" })}>
          {t("style:previewOnly")}
        </span>
        <div style={{ width: 1, background: "var(--c-border)", margin: "0 2px" }} />
        <IconBtn on={style.bold} label={t("style:boldToggle")} onClick={() => setStyle({ bold: !style.bold })}>
          B
        </IconBtn>
        <IconBtn on={style.italic} label={t("style:italicToggle")} onClick={() => setStyle({ italic: !style.italic })}>
          <span style={{ fontStyle: "italic" }}>I</span>
        </IconBtn>
        <IconBtn on={style.uppercase} label={t("style:uppercaseToggle")} onClick={() => setStyle({ uppercase: !style.uppercase })}>
          TT
        </IconBtn>
      </div>
      <StyleSlider label={t("style:letterSpacing")} field="letterSpacing" value={style.letterSpacing} onChange={setNum("letterSpacing")} unit=" px" />
      <StyleSlider label={t("style:lineHeight")} field="lineHeight" value={style.lineHeight} onChange={setNum("lineHeight")} badge={t("style:previewOnly")} />

      <div style={{ ...sectionLabel, marginTop: 6 }}>{t("style:outlineShadowGlow")}</div>
      <ToggleRow label={t("style:outline")} on={style.outline} onClick={() => setStyle({ outline: !style.outline })} />
      {style.outline && (
        <StyleSlider label={t("style:outlineWidth")} field="outlineWidth" value={style.outlineWidth} onChange={setNum("outlineWidth")} unit=" px" />
      )}
      <ToggleRow label={t("style:shadow")} on={style.shadow} onClick={() => setStyle({ shadow: !style.shadow })} />
      {style.shadow && (
        <StyleSlider label={t("style:shadowDepth")} field="shadowDepth" value={style.shadowDepth} onChange={setNum("shadowDepth")} unit=" px" />
      )}
      <ToggleRow label={t("style:glow")} on={style.glow} onClick={() => setStyle({ glow: !style.glow })} badge={t("style:previewOnly")} />
      {style.glow && (
        <StyleSlider label={t("style:glowStrength")} field="glowStrength" value={style.glowStrength} onChange={setNum("glowStrength")} unit=" px" />
      )}

      <div style={{ ...sectionLabel, marginTop: 6 }}>{t("style:colors")}</div>
      <ColorRow label={t("style:textColor")} value={style.textColor} onChange={(v) => setStyle({ textColor: v })} />
      <ColorRow label={t("style:outline")} value={style.outlineColor} onChange={(v) => setStyle({ outlineColor: v })} />
      <ColorRow label={t("style:shadow")} value={style.shadowColor} onChange={(v) => setStyle({ shadowColor: v })} />
      <ColorRow label={t("style:glow")} value={style.glowColor} onChange={(v) => setStyle({ glowColor: v })} badge={t("style:previewOnly")} />

      <div style={{ ...sectionLabel, marginTop: 12 }}>{t("style:captionBox")}</div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gridTemplateRows: "repeat(3,20px)", gap: 4, width: 76 }}>
          {BOX_GRID.map((pos) => {
            const on = pos === style.boxPosition;
            return (
              <button
                key={pos}
                onClick={() => setStyle({ boxPosition: pos })}
                aria-label={t(`style:boxPos.${pos}`)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  cursor: "pointer",
                  borderRadius: 5,
                  border: `1px solid ${on ? COLORS.blue : "var(--c-border)"}`,
                  background: on ? "rgba(37,99,255,.16)" : "var(--c-input)",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: 2, background: on ? COLORS.blue : "var(--c-muted)" }} />
              </button>
            );
          })}
        </div>
        <div style={f(400, 10, "body", { flex: 1, color: "var(--c-text2)", lineHeight: 1.5 })}>
          {t("style:boxPosition")}
          <br />
          <span style={{ color: "var(--c-text)", fontWeight: 600 }}>{t(`style:boxPos.${style.boxPosition}`)}</span>
        </div>
      </div>
      <StyleSlider label={t("style:width")} field="widthPct" value={style.widthPct} onChange={setNum("widthPct")} unit="%" />
      {row !== "middle" && (
        <StyleSlider
          label={row === "top" ? t("style:topDistance") : t("style:bottomDistance")}
          field="marginVPct"
          value={style.marginVPct}
          onChange={setNum("marginVPct")}
          unit="%"
        />
      )}

      <button
        onClick={resetStyle}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          width: "100%",
          height: 30,
          marginTop: 8,
          background: "var(--c-raised)",
          border: "1px solid var(--c-border)",
          borderRadius: 7,
          color: "var(--c-text2)",
          cursor: "pointer",
          ...f(600, 10),
        }}
      >
        <RotateCcw size={12} />
        {t("style:reset")}
      </button>
    </>
  );
}

function StyleSlider({
  label,
  field,
  value,
  onChange,
  unit = "",
  badge,
}: {
  label: string;
  field: NumericStyleField;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  badge?: string;
}) {
  const lim = STYLE_LIMITS[field];
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, ...f(400, 10, "body", { color: "var(--c-text2)" }) }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {label}
          {badge && (
            <span style={f(600, 8, "body", { color: COLORS.amber, border: `1px solid ${COLORS.amber}55`, borderRadius: 4, padding: "1px 5px", letterSpacing: ".06em", textTransform: "uppercase" })}>
              {badge}
            </span>
          )}
        </span>
        <span style={{ fontFamily: FONTS.mono, fontWeight: 600, fontSize: 10, color: "var(--c-text)" }}>
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={lim.min}
        max={lim.max}
        step={lim.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", marginBottom: 12, accentColor: COLORS.blue }}
        aria-label={label}
      />
    </>
  );
}

function ToggleRow({ label, on, onClick, badge }: { label: string; on: boolean; onClick: () => void; badge?: string }) {
  const sw = toggle(on);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 11 }}>
      <button
        onClick={onClick}
        role="switch"
        aria-checked={on}
        aria-label={label}
        style={{ ...sw.track, border: "none", padding: 0 }}
      >
        <span style={sw.knob} />
      </button>
      <span style={f(500, 11, "body", { color: "var(--c-text)" })}>{label}</span>
      {badge && (
        <span style={f(600, 8, "body", { color: COLORS.amber, border: `1px solid ${COLORS.amber}55`, borderRadius: 4, padding: "1px 5px", letterSpacing: ".06em", textTransform: "uppercase" })}>
          {badge}
        </span>
      )}
    </div>
  );
}

function ColorRow({ label, value, onChange, badge }: { label: string; value: string; onChange: (v: string) => void; badge?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(normalizeHexColor(e.target.value))}
        aria-label={label}
        style={{ width: 30, height: 22, padding: 0, border: "1px solid var(--c-border)", borderRadius: 5, background: "var(--c-input)", cursor: "pointer" }}
      />
      <span style={f(500, 11, "body", { color: "var(--c-text)", flex: "none" })}>{label}</span>
      <span style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: 9, color: "var(--c-muted)" }}>{value}</span>
      {badge && (
        <span style={f(600, 8, "body", { color: COLORS.amber, border: `1px solid ${COLORS.amber}55`, borderRadius: 4, padding: "1px 5px", letterSpacing: ".06em", textTransform: "uppercase" })}>
          {badge}
        </span>
      )}
    </div>
  );
}

function IconBtn({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on} aria-label={label} title={label} style={{ ...iconBtn(on), cursor: "pointer", padding: 0 }}>
      {children}
    </button>
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
