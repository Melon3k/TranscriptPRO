import type { ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { f, sectionLabel, selectStyle } from "../../lib/ui";

/** Uppercase section label above a control. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <div style={sectionLabel}>{children}</div>;
}

/** A native <select> styled as the design's input shell (with a chevron). */
export function Select({
  style,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div style={{ position: "relative" }}>
      <select {...props} style={{ ...selectStyle, ...style }} />
      <ChevronDown
        size={13}
        color="var(--c-muted)"
        style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
      />
    </div>
  );
}

/** A checkbox row rendered as the design's square + label. */
export function CheckRow({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 9,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16, marginTop: 1, accentColor: "#2563FF", cursor: disabled ? "not-allowed" : "pointer" }}
      />
      <span>
        <span style={f(500, 12, "body", { color: "var(--c-text)" })}>{label}</span>
        {hint && <div style={f(400, 11, "body", { color: "var(--c-muted)", marginTop: 2, lineHeight: 1.4 })}>{hint}</div>}
      </span>
    </label>
  );
}
