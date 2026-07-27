import { useEffect } from "react";
import { Check, Info, X } from "lucide-react";
import { useNotifyStore } from "../../stores/notifyStore";
import { COLORS, f } from "../../lib/ui";

/**
 * Transient top banner (success / error / info), driven by notifyStore. Success
 * and info auto-dismiss after 4s; errors STAY until the ✕ is clicked so a
 * failure after a long-running job can't scroll past unseen. Mirrors the
 * design's banner strip.
 */
export default function Banner() {
  const banner = useNotifyStore((s) => s.banner);
  const dismiss = useNotifyStore((s) => s.dismiss);

  useEffect(() => {
    // Errors are sticky (manual dismiss only) — don't schedule auto-dismiss.
    if (!banner || banner.kind === "error") return;
    const id = window.setTimeout(dismiss, 4000);
    return () => window.clearTimeout(id);
  }, [banner, dismiss]);

  if (!banner) return null;
  const bg =
    banner.kind === "success"
      ? COLORS.green
      : banner.kind === "info"
        ? COLORS.blue
        : COLORS.red;

  return (
    <div
      style={{
        flex: "none",
        height: 40,
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "0 16px",
        color: "#fff",
        background: bg,
      }}
    >
      {banner.kind === "success" ? (
        <Check size={15} />
      ) : banner.kind === "info" ? (
        <Info size={15} />
      ) : (
        <X size={15} />
      )}
      <span style={f(600, 12)}>{banner.message}</span>
      <div style={{ flex: 1 }} />
      <button
        onClick={dismiss}
        style={{
          background: "none",
          border: "none",
          color: "#fff",
          opacity: 0.7,
          cursor: "pointer",
          display: "flex",
          padding: 0,
        }}
        aria-label="dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
