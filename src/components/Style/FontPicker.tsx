import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronDown } from "lucide-react";
import { COLORS, f, FONTS, selectStyle } from "../../lib/ui";
import {
  BUNDLED_FAMILIES,
  CAPTION_FONTS,
  fontFamilyCss,
} from "../../lib/caption-style";
import { listSystemFonts } from "../../lib/tauri-commands";

type TFn = (key: string, opts?: Record<string, unknown>) => string;

// Cached across mounts so re-opening the Inspector never refetches the (few
// hundred) system families — the list can't change within a session.
let systemFontsCache: string[] | null = null;

/** Searchable font picker: three bundled quick-picks pinned under a "Bundled"
 *  heading, the full installed-family list below, each row previewed in its own
 *  face. Replaces the Inspector's 3-option <select>; the picked family flows to
 *  the live overlay and the MP4 burn-in. */
export default function FontPicker({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (family: string) => void;
  t: TFn;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [systemFonts, setSystemFonts] = useState<string[]>(
    () => systemFontsCache ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const bundled = useMemo(() => CAPTION_FONTS.map((font) => font.family), []);
  // Lower-cased bundled families for case-insensitive dedupe of the system
  // list: fontdb may report a family whose casing differs from the bundled
  // spelling (e.g. "inter" vs "Inter"), and it must still be filtered out so
  // it doesn't appear twice.
  const bundledLower = useMemo(
    () => new Set([...BUNDLED_FAMILIES].map((family) => family.toLowerCase())),
    [],
  );

  // Lazily fetch the system list once, on first open.
  useEffect(() => {
    if (!open) return;
    // Already loaded (this mount or a prior one) — re-sync state from the
    // cache and skip the fetch. This also recovers the cancel-race: if a
    // previous open's fetch resolved AFTER the panel was closed, the cache was
    // populated but setSystemFonts was skipped; reopening syncs it here.
    if (systemFontsCache !== null) {
      setSystemFonts(systemFontsCache);
      return;
    }
    setLoading(true);
    let cancelled = false;
    listSystemFonts()
      .then((fonts) => {
        // Cache ONLY on success so a transient first-open failure isn't
        // remembered as an empty list for the rest of the session.
        systemFontsCache = fonts;
        if (!cancelled) setSystemFonts(fonts);
      })
      .catch(() => {
        // Leave the cache null so the next open retries.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Click-outside closes; listener only mounted while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = search.trim().toLowerCase();
  const match = (family: string) => !q || family.toLowerCase().includes(q);

  const bundledMatches = bundled.filter(match);
  const systemMatches = systemFonts.filter(
    (family) => !bundledLower.has(family.toLowerCase()) && match(family),
  );
  // Flattened visible list for keyboard navigation (bundled first, then system).
  const flat = useMemo(
    () => [...bundledMatches, ...systemMatches],
    [bundledMatches, systemMatches],
  );

  // Keep the highlighted index in range as the filter narrows the list.
  useEffect(() => {
    setHighlight((h) => (flat.length === 0 ? 0 : Math.min(h, flat.length - 1)));
  }, [flat.length]);

  const openPanel = () => {
    setOpen(true);
    setSearch("");
    setHighlight(0);
  };

  const pick = (family: string) => {
    onChange(family);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (flat.length === 0 ? 0 : Math.min(h + 1, flat.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const family = flat[highlight];
      if (family) pick(family);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-label={t("style:font")}
        data-tip={t("style:font")}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          ...selectStyle,
          display: "flex",
          alignItems: "center",
          textAlign: "left",
          fontFamily: fontFamilyCss(value),
          fontWeight: 600,
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value}
        </span>
        <ChevronDown size={13} color="var(--c-muted)" style={{ flex: "none", marginLeft: 6 }} />
      </button>

      {open && (
        <div
          onKeyDown={onKeyDown}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 40,
            display: "flex",
            flexDirection: "column",
            maxHeight: 300,
            background: "var(--c-panel)",
            border: "1px solid var(--c-border)",
            borderRadius: 9,
            boxShadow: "0 16px 40px rgba(0,0,0,.4)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 8, borderBottom: "1px solid var(--c-border)" }}>
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("style:fontPicker.search")}
              aria-label={t("style:fontPicker.search")}
              style={{
                width: "100%",
                height: 28,
                padding: "0 9px",
                background: "var(--c-input)",
                border: "1px solid var(--c-border)",
                borderRadius: 7,
                color: "var(--c-text)",
                outline: "none",
                ...f(400, 11, "body"),
              }}
            />
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 4 }}>
            {loading && (
              <div style={f(400, 10, "body", { color: "var(--c-muted)", padding: "8px 8px" })}>
                {t("style:fontPicker.loading")}
              </div>
            )}
            {!loading && flat.length === 0 && (
              <div style={f(400, 10, "body", { color: "var(--c-muted)", padding: "8px 8px" })}>
                {t("style:fontPicker.empty")}
              </div>
            )}
            {bundledMatches.length > 0 && (
              <>
                <div style={headingStyle}>{t("style:fontPicker.bundled")}</div>
                {bundledMatches.map((family) => (
                  <FontRow
                    key={family}
                    family={family}
                    selected={family === value}
                    highlighted={flat[highlight] === family}
                    onClick={() => pick(family)}
                    onHover={() => setHighlight(flat.indexOf(family))}
                  />
                ))}
              </>
            )}
            {systemMatches.length > 0 && (
              <>
                <div style={headingStyle}>{t("style:fontPicker.system")}</div>
                {systemMatches.map((family) => (
                  <FontRow
                    key={family}
                    family={family}
                    selected={family === value}
                    highlighted={flat[highlight] === family}
                    onClick={() => pick(family)}
                    onHover={() => setHighlight(flat.indexOf(family))}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const headingStyle: CSSProperties = {
  fontFamily: FONTS.body,
  fontWeight: 600,
  fontSize: 9,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  color: "var(--c-muted)",
  padding: "8px 8px 4px",
};

function FontRow({
  family,
  selected,
  highlighted,
  onClick,
  onHover,
}: {
  family: string;
  selected: boolean;
  highlighted: boolean;
  onClick: () => void;
  onHover: () => void;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onHover}
      aria-selected={selected}
      role="option"
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "6px 8px",
        marginBottom: 1,
        borderRadius: 6,
        cursor: "pointer",
        border: `1px solid ${selected ? COLORS.blue : "transparent"}`,
        background: selected
          ? "rgba(37,99,255,.16)"
          : highlighted
            ? "var(--c-raised)"
            : "transparent",
        color: selected ? COLORS.blueLight : "var(--c-text)",
        fontFamily: fontFamilyCss(family),
        fontWeight: 500,
        fontSize: 13,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {family}
    </button>
  );
}
