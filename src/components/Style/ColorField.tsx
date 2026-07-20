import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { HexAlphaColorPicker } from "react-colorful";
import { useTranslation } from "react-i18next";
import { COLORS, f, FONTS } from "../../lib/ui";
import {
  hexToCssColor,
  normalizeHexColor,
  parseHexColor,
  rgbaToHex8,
} from "../../lib/caption-style";

// Amber pill (matches StylePanel's preview-only badge).
const pill: CSSProperties = f(600, 8, "body", {
  color: COLORS.amber,
  border: `1px solid ${COLORS.amber}55`,
  borderRadius: 4,
  padding: "1px 5px",
  letterSpacing: ".06em",
  textTransform: "uppercase",
});

// 6px checkerboard behind the swatch/flat-color overlay so alpha reads.
const CHECKER =
  "conic-gradient(#0000 90deg,#0003 0 180deg,#0000 0 270deg,#0003 0)";

const numInput: CSSProperties = {
  width: 42,
  fontFamily: FONTS.mono,
  fontSize: 10,
  background: "var(--c-input)",
  border: "1px solid var(--c-border)",
  borderRadius: 5,
  color: "var(--c-text)",
  padding: "2px 4px",
  outline: "none",
};

/**
 * A color row with a popover picker. `value` is the canonical 8-digit
 * `#RRGGBBAA`; `onChange` always receives a normalized 8-digit hex. The picker
 * lives in a fixed-position layer (the Inspector scrolls, so an in-flow
 * absolute popover would clip).
 */
export default function ColorField({
  label,
  value,
  onChange,
  badge,
  hint,
}: {
  label: string;
  value: string; // 8-digit hex
  onChange: (hex8: string) => void;
  badge?: string;
  hint?: string;
}) {
  const { t } = useTranslation(["style"]);
  const [open, setOpen] = useState(false);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const recompute = () => {
    if (swatchRef.current) setRect(swatchRef.current.getBoundingClientRect());
  };

  useLayoutEffect(() => {
    if (!open) return;
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || swatchRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    setOpen(false);
    swatchRef.current?.focus();
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
      <button
        ref={swatchRef}
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          position: "relative",
          width: 30,
          height: 22,
          padding: 0,
          border: "1px solid var(--c-border)",
          borderRadius: 5,
          backgroundImage: CHECKER,
          backgroundSize: "6px 6px",
          cursor: "pointer",
          overflow: "hidden",
        }}
      >
        {/* Flat color overlay — alpha lets the checkerboard show through. */}
        <span
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: hexToCssColor(value),
          }}
        />
      </button>
      <span style={f(500, 11, "body", { color: "var(--c-text)", flex: "none" })}>{label}</span>
      {badge && <span style={pill}>{badge}</span>}

      {open && rect && (
        <Popover
          rect={rect}
          value={value}
          onChange={onChange}
          hint={hint}
          popRef={popRef}
          t={t}
        />
      )}
    </div>
  );
}

function Popover({
  rect,
  value,
  onChange,
  hint,
  popRef,
  t,
}: {
  rect: DOMRect;
  value: string;
  onChange: (hex8: string) => void;
  hint?: string;
  popRef: RefObject<HTMLDivElement | null>;
  t: (key: string) => string;
}) {
  const c = parseHexColor(value) ?? { r: 0, g: 0, b: 0, a: 255 };

  // Hex draft: holds in-progress (possibly invalid) text; resync on value flow.
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  // Per-channel drafts so an empty/partial intermediate isn't committed as 0
  // (Number("") === 0 would snap alpha to fully transparent mid-edit).
  const [chanDraft, setChanDraft] = useState<Record<"r" | "g" | "b" | "a", string>>({
    r: String(c.r),
    g: String(c.g),
    b: String(c.b),
    a: String(c.a),
  });
  useEffect(() => {
    setChanDraft({ r: String(c.r), g: String(c.g), b: String(c.b), a: String(c.a) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const setChannel = (key: "r" | "g" | "b" | "a", raw: string) => {
    setChanDraft((d) => ({ ...d, [key]: raw }));
    // Hold empty/non-numeric intermediates; only commit a real value.
    if (raw.trim() === "" || Number.isNaN(Number(raw))) return;
    const n = Math.min(255, Math.max(0, Math.round(Number(raw))));
    const next = { ...c, [key]: n };
    onChange(rgbaToHex8(next.r, next.g, next.b, next.a));
  };

  const commitChannel = (key: "r" | "g" | "b" | "a") => {
    // On blur, revert an empty/invalid draft to the canonical channel value.
    setChanDraft((d) => ({ ...d, [key]: String(c[key]) }));
  };

  const onHexChange = (v: string) => {
    setDraft(v);
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      // Keep the current alpha byte when only RGB is typed.
      const rgb = parseHexColor(v)!;
      onChange(rgbaToHex8(rgb.r, rgb.g, rgb.b, c.a));
    } else if (/^#[0-9a-fA-F]{8}$/.test(v)) {
      onChange(normalizeHexColor(v));
    }
  };

  const POP_W = 204;
  const GAP = 6;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - POP_W - 8));

  // Flip above the swatch when the popover would overflow the bottom edge.
  const [popH, setPopH] = useState(0);
  useLayoutEffect(() => {
    if (popRef.current) setPopH(popRef.current.getBoundingClientRect().height);
  }, [value, hint]);
  const belowTop = rect.bottom + GAP;
  const flipAbove = popH > 0 && belowTop + popH > window.innerHeight - 8 && rect.top - GAP - popH >= 8;
  const top = flipAbove
    ? Math.max(8, rect.top - GAP - popH)
    : Math.max(8, Math.min(belowTop, window.innerHeight - 8 - popH));

  const chan = (key: "r" | "g" | "b" | "a", labelKey: string) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
      <span style={f(600, 8, "body", { color: "var(--c-muted)", letterSpacing: ".04em" })}>
        {t(`style:fields.${labelKey}`)}
      </span>
      <input
        type="number"
        min={0}
        max={255}
        value={chanDraft[key]}
        onChange={(e) => setChannel(key, e.target.value)}
        onBlur={() => commitChannel(key)}
        aria-label={t(`style:fields.${labelKey}`)}
        style={numInput}
      />
    </label>
  );

  return (
    <div
      ref={popRef}
      role="dialog"
      style={{
        position: "fixed",
        top,
        left,
        zIndex: 80,
        width: POP_W,
        padding: 12,
        background: "var(--c-panel)",
        border: "1px solid var(--c-border)",
        borderRadius: 10,
        boxShadow: "0 20px 50px rgba(0,0,0,.5)",
        color: "var(--c-text)",
      }}
    >
      <div className="tpro-colorful" style={{ marginBottom: 10 }}>
        <HexAlphaColorPicker color={value} onChange={(h) => onChange(normalizeHexColor(h))} />
      </div>

      <div style={{ display: "flex", gap: 5, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 78 }}>
          <span style={f(600, 8, "body", { color: "var(--c-muted)", letterSpacing: ".04em" })}>
            {t("style:fields.hex")}
          </span>
          <input
            type="text"
            value={draft}
            onChange={(e) => onHexChange(e.target.value)}
            onBlur={() => {
              if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(draft)) setDraft(value);
            }}
            maxLength={9}
            spellCheck={false}
            aria-label={t("style:fields.hex")}
            style={{ ...numInput, width: "100%" }}
          />
        </label>
        {chan("r", "r")}
        {chan("g", "g")}
        {chan("b", "b")}
        {chan("a", "alpha")}
      </div>

      {hint && (
        <div style={f(400, 9, "body", { color: "var(--c-muted)", marginTop: 8, lineHeight: 1.4 })}>
          {hint}
        </div>
      )}
    </div>
  );
}
