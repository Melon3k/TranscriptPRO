import { useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Sparkles, Layers, Search, Plus, RotateCcw, Copy, Trash2, Pencil, Check, X, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { COLORS, f, FONTS, tabStyle, sectionLabel, toggle } from "../../lib/ui";
import { useStyleStore } from "../../stores/styleStore";
import ColorField from "./ColorField";
import FontPicker from "./FontPicker";
import {
  BOX_GRID,
  STYLE_LIMITS,
  captionTextCss,
  type NumericStyleField,
} from "../../lib/caption-style";
import {
  ANIMATION_TYPES,
  ANIMATION_LIMITS,
  type NumericAnimationField,
} from "../../lib/caption-animation";
import { BUILTIN_PRESETS, uniquePresetName } from "../../lib/caption-presets";
import { useNotifyStore } from "../../stores/notifyStore";
import {
  ANIMATION_DIRECTION_OPTIONS,
  ANIMATION_GRANULARITY_OPTIONS,
  KARAOKE_HIGHLIGHT_OPTIONS,
  STAGGERED_ANIMATIONS,
} from "../../types/captionStyle";
import type {
  AnimationDirection,
  AnimationGranularity,
  CaptionAlign,
  CaptionAnimationType,
  CaptionStyle,
  KaraokeHighlight,
} from "../../types/captionStyle";

type StyleTab = "inspector" | "anim" | "effects";

/**
 * Caption STYLING workspace. All three tabs are live: Inspector (item A) edits
 * the global CaptionStyle, Animations (item C) edits the global CaptionAnimation,
 * Effects (item D) manages style presets — all in styleStore.
 */
export default function StylePanel() {
  const { t } = useTranslation(["style", "common"]);
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
      ) : tab === "effects" ? (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <Effects t={t} />
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <Animations t={t} />
        </div>
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
      <div style={{ marginBottom: 12 }}>
        <FontPicker value={style.fontId} onChange={(family) => setStyle({ fontId: family })} t={t} />
      </div>
      <StyleSlider label={t("style:size")} field="fontSize" value={style.fontSize} onChange={setNum("fontSize")} unit=" px" />
      <div style={{ display: "flex", gap: 6, margin: "0 0 12px", alignItems: "center" }}>
        {(["left", "center", "right"] as const).map((a) => (
          <IconBtn key={a} on={style.align === a} label={t(`style:align.${a}`)} onClick={() => setStyle({ align: a as CaptionAlign })}>
            {a === "left" ? <AlignLeft size={15} /> : a === "center" ? <AlignCenter size={15} /> : <AlignRight size={15} />}
          </IconBtn>
        ))}
        {/* align now exports: ass.rs maps it to the numpad Alignment COLUMN
            (justification) while boxPosition drives the box region — see
            effective_alignment. So no preview-only badge here anymore. */}
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
      <ColorField label={t("style:textColor")} value={style.textColor} onChange={(v) => setStyle({ textColor: v })} hint={t("style:alphaTextHint")} />

      <div style={{ ...sectionLabel, marginTop: 6 }}>{t("style:outlineShadowGlow")}</div>
      <ToggleRow label={t("style:outline")} on={style.outline} onClick={() => setStyle({ outline: !style.outline })} />
      {style.outline && (
        <>
          <ColorField label={t("style:outline")} value={style.outlineColor} onChange={(v) => setStyle({ outlineColor: v })} />
          <StyleSlider label={t("style:outlineWidth")} field="outlineWidth" value={style.outlineWidth} onChange={setNum("outlineWidth")} unit=" px" />
        </>
      )}
      <ToggleRow label={t("style:shadow")} on={style.shadow} onClick={() => setStyle({ shadow: !style.shadow })} />
      {style.shadow && (
        <>
          <ColorField label={t("style:shadow")} value={style.shadowColor} onChange={(v) => setStyle({ shadowColor: v })} />
          <StyleSlider label={t("style:shadowAngle")} field="shadowAngle" value={style.shadowAngle} onChange={setNum("shadowAngle")} unit=" °" />
          <StyleSlider label={t("style:shadowDistance")} field="shadowDistance" value={style.shadowDistance} onChange={setNum("shadowDistance")} unit=" px" />
          <StyleSlider label={t("style:shadowSize")} field="shadowSize" value={style.shadowSize} onChange={setNum("shadowSize")} unit=" px" />
          <StyleSlider label={t("style:shadowBlur")} field="shadowBlur" value={style.shadowBlur} onChange={setNum("shadowBlur")} unit=" px" />
        </>
      )}
      <ToggleRow label={t("style:glow")} on={style.glow} onClick={() => setStyle({ glow: !style.glow })} />
      {style.glow && (
        <>
          <ColorField label={t("style:glow")} value={style.glowColor} onChange={(v) => setStyle({ glowColor: v })} />
          <StyleSlider label={t("style:glowStrength")} field="glowStrength" value={style.glowStrength} onChange={setNum("glowStrength")} unit=" px" />
        </>
      )}

      <div style={{ ...sectionLabel, marginTop: 6 }}>{t("style:background")}</div>
      <ToggleRow label={t("style:background")} on={style.background} onClick={() => setStyle({ background: !style.background })} />
      {style.background && (
        <>
          <ColorField label={t("style:backgroundColor")} value={style.backgroundColor} onChange={(v) => setStyle({ backgroundColor: v })} />
          <StyleSlider label={t("style:backgroundRadius")} field="backgroundRadius" value={style.backgroundRadius} onChange={setNum("backgroundRadius")} unit=" px" />
          <StyleSlider label={t("style:backgroundSpread")} field="backgroundSpread" value={style.backgroundSpread} onChange={setNum("backgroundSpread")} unit=" px" />
        </>
      )}

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

function IconBtn({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on} aria-label={label} data-tip={label} style={{ ...iconBtn(on), cursor: "pointer", padding: 0 }}>
      {children}
    </button>
  );
}

function Animations({ t }: { t: TFn }) {
  const animation = useStyleStore((s) => s.animation);
  const setAnimation = useStyleStore((s) => s.setAnimation);

  const type = animation.type;
  const granularityOpts = ANIMATION_GRANULARITY_OPTIONS[type];
  const directionOpts = ANIMATION_DIRECTION_OPTIONS[type];

  // Switching type resets any sub-option that the new type doesn't expose (or
  // whose current value isn't in its menu) to that menu's default, mirroring
  // the sanitizer so preview/export always read a valid combination.
  const selectType = (at: CaptionAnimationType) => {
    const gOpts = ANIMATION_GRANULARITY_OPTIONS[at];
    const dOpts = ANIMATION_DIRECTION_OPTIONS[at];
    setAnimation({
      type: at,
      ...(gOpts.length && !gOpts.includes(animation.granularity)
        ? { granularity: gOpts[0] }
        : {}),
      ...(dOpts.length && !dOpts.includes(animation.direction)
        ? { direction: dOpts[0] }
        : {}),
    });
  };

  return (
    <>
      {/* Animation is global (accepted scope decision) — no per-segment "apply
          to selected" pills; a static note replaces the mock's pill row. */}
      <div style={sectionLabel}>{t("style:anim.appliesAll")}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        {ANIMATION_TYPES.map((at) => {
          const active = type === at;
          return (
            <button
              key={at}
              onClick={() => selectType(at)}
              aria-pressed={active}
              style={{
                position: "relative",
                display: "block",
                textAlign: "left",
                padding: 0,
                cursor: "pointer",
                border: `1px solid ${active ? COLORS.violet : "var(--c-border)"}`,
                borderRadius: 8,
                overflow: "hidden",
                background: "var(--c-panel)",
              }}
            >
              {/* Dark tone only on the preview tile (so the white sample reads),
                  NOT the whole card — the label row below must follow the theme
                  or its var(--c-text) goes invisible in light mode. */}
              <div style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "#0c1017" }}>
                <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 22, color: "#fff", WebkitTextStroke: "0.5px #0D1117" }}>Aa</span>
              </div>
              {at !== "none" && (
                <span style={{ position: "absolute", top: 4, right: 4, ...badge(COLORS.cyan) }}>
                  {t("style:anim.exported")}
                </span>
              )}
              <div style={{ ...f(600, 10), padding: "5px 8px", borderTop: "1px solid var(--c-border)", color: active ? COLORS.violetLight : "var(--c-text)" }}>
                {t(`style:anim.types.${at}`)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Duration drives fade's \fad and the entrance types' CSS transitions.
          Karaoke derives its \k sweep from word/cue timings and ignores
          durationMs in both preview and export, so the slider is hidden there
          rather than shown as an inert control. */}
      {type !== "none" && type !== "karaoke" && (
        <AnimSlider label={t("style:anim.duration")} field="durationMs" value={animation.durationMs} onChange={(v) => setAnimation({ durationMs: v })} unit=" ms" />
      )}

      {/* Granularity / direction menus appear only for types that expose them
          (single source of truth: ANIMATION_*_OPTIONS). */}
      {granularityOpts.length > 0 && (
        <AnimChoice<AnimationGranularity>
          label={t("style:anim.granularity.label")}
          value={animation.granularity}
          options={granularityOpts}
          labelFor={(o) => t(`style:anim.granularity.${o}`)}
          onChange={(v) => setAnimation({ granularity: v })}
        />
      )}
      {directionOpts.length > 0 && (
        <AnimChoice<AnimationDirection>
          label={t("style:anim.direction.label")}
          value={animation.direction}
          options={directionOpts}
          labelFor={(o) => t(`style:anim.direction.${o}`)}
          onChange={(v) => setAnimation({ direction: v })}
        />
      )}

      {/* Per-unit stagger only matters for the staggered entrance types. */}
      {STAGGERED_ANIMATIONS.has(type) && (
        <AnimSlider label={t("style:anim.stagger")} field="staggerMs" value={animation.staggerMs} onChange={(v) => setAnimation({ staggerMs: v })} unit=" ms" />
      )}

      {type === "karaoke" && (
        <AnimChoice<KaraokeHighlight>
          label={t("style:anim.karaokeHighlight.label")}
          value={animation.karaokeHighlight}
          options={KARAOKE_HIGHLIGHT_OPTIONS}
          labelFor={(o) => t(`style:anim.karaokeHighlight.${o}`)}
          onChange={(v) => setAnimation({ karaokeHighlight: v })}
        />
      )}

      {/* The accent colour feeds karaoke's \k sung colour and colorShift's sweep. */}
      {(type === "karaoke" || type === "colorShift") && (
        <ColorField label={t("style:anim.highlightColor")} value={animation.highlightColor} onChange={(v) => setAnimation({ highlightColor: v })} badge={t("style:anim.exported")} />
      )}
    </>
  );
}

/** Segmented control for an animation sub-option (granularity / direction /
 *  karaoke highlight). Rendered only when its option list is non-empty. */
function AnimChoice<T extends string>({
  label,
  value,
  options,
  labelFor,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labelFor: (o: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ ...f(400, 10, "body", { color: "var(--c-text2)" }), marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 6 }}>
        {options.map((opt) => {
          const on = opt === value;
          return (
            <button
              key={opt}
              onClick={() => onChange(opt)}
              aria-pressed={on}
              style={{
                flex: 1,
                padding: "6px 4px",
                borderRadius: 6,
                cursor: "pointer",
                border: `1px solid ${on ? COLORS.violet : "var(--c-border)"}`,
                background: on ? `${COLORS.violet}22` : "var(--c-panel)",
                color: on ? COLORS.violetLight : "var(--c-text)",
                ...f(600, 10),
              }}
            >
              {labelFor(opt)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Mirrors StyleSlider but reads ANIMATION_LIMITS instead of STYLE_LIMITS.
function AnimSlider({
  label,
  field,
  value,
  onChange,
  unit = "",
  badge: badgeText,
}: {
  label: string;
  field: NumericAnimationField;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  badge?: string;
}) {
  const lim = ANIMATION_LIMITS[field];
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, ...f(400, 10, "body", { color: "var(--c-text2)" }) }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {label}
          {badgeText && (
            <span style={f(600, 8, "body", { color: COLORS.amber, border: `1px solid ${COLORS.amber}55`, borderRadius: 4, padding: "1px 5px", letterSpacing: ".06em", textTransform: "uppercase" })}>
              {badgeText}
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

/** A preset as rendered in the grid: built-ins carry a resolved (translated)
 *  name and no persisted identity; user presets are their store rows. */
interface PresetItem {
  id: string;
  name: string;
  style: CaptionStyle;
  builtin: boolean;
}

function Effects({ t }: { t: TFn }) {
  const style = useStyleStore((s) => s.style);
  const activePresetId = useStyleStore((s) => s.activePresetId);
  const applyPreset = useStyleStore((s) => s.applyPreset);
  const presets = useStyleStore((s) => s.presets);
  const addPreset = useStyleStore((s) => s.addPreset);
  const updatePreset = useStyleStore((s) => s.updatePreset);
  const deletePreset = useStyleStore((s) => s.deletePreset);
  const notify = useNotifyStore((s) => s.notify);

  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const items: PresetItem[] = [
    ...BUILTIN_PRESETS.map((p) => ({ id: p.id, name: t(p.nameKey), style: p.style, builtin: true })),
    ...presets.map((p) => ({ id: p.id, name: p.name, style: p.style, builtin: false })),
  ];
  const allNames = items.map((p) => p.name);
  const q = search.trim().toLowerCase();
  const filtered = q ? items.filter((p) => p.name.toLowerCase().includes(q)) : items;

  const onNew = () => {
    const id = addPreset(uniquePresetName(t("style:presets.defaultName"), allNames), style);
    setEditingId(id);
    setSearch("");
    notify("success", t("style:presets.saved"));
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, height: 28, padding: "0 9px", background: "var(--c-input)", border: "1px solid var(--c-border)", borderRadius: 7, color: "var(--c-muted)" }}>
          <Search size={12} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("style:searchPreset")}
            aria-label={t("style:searchPreset")}
            style={{ flex: 1, minWidth: 0, background: "none", border: "none", outline: "none", color: "var(--c-text)", ...f(400, 10, "body") }}
          />
        </div>
        <button
          onClick={onNew}
          data-tip={t("style:presets.tips.new")}
          style={{ display: "flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", background: "rgba(37,99,255,.14)", border: `1px solid ${COLORS.blue}`, borderRadius: 7, color: COLORS.blueLight, cursor: "pointer", ...f(600, 10) }}
        >
          <Plus size={12} />
          {t("style:newPreset")}
        </button>
      </div>
      {filtered.length === 0 ? (
        <div style={f(400, 10, "body", { color: "var(--c-muted)", padding: "8px 2px" })}>{t("style:presets.empty")}</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
          {filtered.map((preset) => (
            <PresetCard
              key={preset.id}
              t={t}
              preset={preset}
              active={activePresetId === preset.id}
              editing={editingId === preset.id}
              confirmingDelete={confirmDeleteId === preset.id}
              onApply={() => applyPreset(preset.id, preset.style)}
              onDuplicate={() => {
                const id = addPreset(uniquePresetName(preset.name, allNames), preset.style);
                setEditingId(id);
              }}
              onSaveOver={() => {
                updatePreset(preset.id, { style });
                notify("success", t("style:presets.saved"));
              }}
              onRename={(name) => updatePreset(preset.id, { name })}
              setEditing={(on) => setEditingId(on ? preset.id : null)}
              onDeleteRequest={() => setConfirmDeleteId(preset.id)}
              onDeleteConfirm={() => {
                deletePreset(preset.id);
                setConfirmDeleteId(null);
              }}
              onDeleteCancel={() => setConfirmDeleteId(null)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function PresetCard({
  t,
  preset,
  active,
  editing,
  confirmingDelete,
  onApply,
  onDuplicate,
  onSaveOver,
  onRename,
  setEditing,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  t: TFn;
  preset: PresetItem;
  active: boolean;
  editing: boolean;
  confirmingDelete: boolean;
  onApply: () => void;
  onDuplicate: () => void;
  onSaveOver: () => void;
  onRename: (name: string) => void;
  setEditing: (on: boolean) => void;
  onDeleteRequest: () => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}) {
  // Escape must cancel without the trailing blur re-committing the draft.
  const cancelledRef = useRef(false);
  const commit = (value: string) => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
    } else {
      onRename(value.trim() || preset.name);
    }
    setEditing(false);
  };

  const stop = (fn: () => void) => (e: ReactMouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div
      // While confirming a delete the card must not apply the preset: clicking
      // the prompt label or the preview surface would otherwise silently
      // overwrite the live style instead of answering the dialog.
      onClick={confirmingDelete ? undefined : onApply}
      style={{
        border: `1px solid ${active ? COLORS.cyan : "var(--c-border)"}`,
        borderRadius: 9,
        overflow: "hidden",
        background: "var(--c-panel)",
        cursor: confirmingDelete ? "default" : "pointer",
      }}
    >
      {/* Preview surface picks the tone that contrasts the sample's text color,
          so a dark-text preset stays legible (independent of the app theme). */}
      <div style={{ position: "relative", height: 56, display: "flex", alignItems: "center", justifyContent: "center", background: isLightColor(preset.style.textColor) ? "#0c1017" : "#e9edf2" }}>
        <span style={{ ...captionTextCss(preset.style), fontSize: 30, whiteSpace: "nowrap" }}>Aa</span>
        {active && (
          <span style={{ position: "absolute", top: 4, right: 4, ...badge(COLORS.cyan) }}>{t("style:presets.active")}</span>
        )}
        {preset.builtin && !active && (
          <span style={{ position: "absolute", top: 4, right: 4, ...badge(COLORS.amber) }}>{t("style:presets.builtinBadge")}</span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 6px", borderTop: "1px solid var(--c-border)", minHeight: 28 }}>
        {confirmingDelete ? (
          <>
            <span style={f(600, 9, "body", { flex: 1, minWidth: 0, color: COLORS.red, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
              {t("style:presets.deleteConfirm")}
            </span>
            <ActionBtn label={t("style:presets.delete")} onClick={stop(onDeleteConfirm)} danger>
              <Trash2 size={12} />
            </ActionBtn>
            <ActionBtn label={t("common:cancel")} onClick={stop(onDeleteCancel)}>
              <X size={12} />
            </ActionBtn>
          </>
        ) : editing && !preset.builtin ? (
          <input
            autoFocus
            defaultValue={preset.name}
            aria-label={t("style:presets.namePlaceholder")}
            placeholder={t("style:presets.namePlaceholder")}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") {
                cancelledRef.current = true;
                e.currentTarget.blur();
              }
            }}
            onBlur={(e) => commit(e.currentTarget.value)}
            style={{ flex: 1, minWidth: 0, height: 20, padding: "0 5px", background: "var(--c-input)", border: `1px solid ${COLORS.blue}`, borderRadius: 5, color: "var(--c-text)", outline: "none", ...f(600, 10, "body") }}
          />
        ) : preset.builtin ? (
          <>
            <span style={f(600, 10, "body", { flex: 1, minWidth: 0, color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
              {preset.name}
            </span>
            <ActionBtn label={t("style:presets.duplicate")} tip={t("style:presets.tips.duplicate")} onClick={stop(onDuplicate)}>
              <Copy size={12} />
            </ActionBtn>
          </>
        ) : (
          <>
            <button
              onClick={stop(() => setEditing(true))}
              data-tip={t("style:presets.rename")}
              style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "text", color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...f(600, 10, "body") }}
            >
              {preset.name}
            </button>
            <ActionBtn label={t("style:presets.rename")} tip={t("style:presets.tips.rename")} onClick={stop(() => setEditing(true))}>
              <Pencil size={12} />
            </ActionBtn>
            <ActionBtn label={t("style:presets.save")} tip={t("style:presets.tips.save")} onClick={stop(onSaveOver)}>
              <Check size={12} />
            </ActionBtn>
            <ActionBtn label={t("style:presets.duplicate")} tip={t("style:presets.tips.duplicate")} onClick={stop(onDuplicate)}>
              <Copy size={12} />
            </ActionBtn>
            <ActionBtn label={t("style:presets.delete")} tip={t("style:presets.tips.delete")} onClick={stop(onDeleteRequest)} danger>
              <Trash2 size={12} />
            </ActionBtn>
          </>
        )}
      </div>
    </div>
  );
}

function ActionBtn({ label, tip, onClick, danger, children }: { label: string; tip?: string; onClick: (e: ReactMouseEvent) => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      data-tip={tip || label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 20,
        flex: "none",
        padding: 0,
        borderRadius: 5,
        border: "1px solid var(--c-border)",
        background: "var(--c-raised)",
        color: danger ? COLORS.red : "var(--c-text2)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/** True if a color is light enough to need a dark backdrop (Rec. 601 luma).
 *  Used only to pick a contrasting preview surface; alpha (if present) is
 *  ignored and non-hex inputs are treated as dark. */
function isLightColor(hex: string): boolean {
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}

function badge(color: string): CSSProperties {
  return f(600, 8, "body", {
    color,
    background: "var(--c-panel)",
    border: `1px solid ${color}88`,
    borderRadius: 4,
    padding: "1px 5px",
    letterSpacing: ".06em",
    textTransform: "uppercase",
  });
}

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
