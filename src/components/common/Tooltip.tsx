import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { f } from "../../lib/ui";

// Native `title=` tooltips don't render in the macOS WKWebView, so this is one
// shared, delegated bubble for every control carrying a `data-tip` attribute.
// Delegated listeners (not a per-button wrapper) keep the memo'd segment rows
// from re-rendering.

const SHOW_DELAY = 350;
const MAX_WIDTH = 240;
const GAP = 8; // px between target and bubble
const EDGE = 8; // viewport clamp margin

interface Tip {
  text: string;
  rect: DOMRect;
}

export default function Tooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const currentEl = useRef<Element | null>(null);
  const timer = useRef<number | null>(null);

  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const clearTimer = () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
    const hide = () => {
      clearTimer();
      currentEl.current = null;
      setTip(null);
      setPos(null);
    };
    const schedule = (el: Element) => {
      clearTimer();
      currentEl.current = el;
      timer.current = window.setTimeout(() => {
        const text = el.getAttribute("data-tip");
        if (!text) return;
        setPos(null);
        setTip({ text, rect: el.getBoundingClientRect() });
      }, SHOW_DELAY);
    };

    const onOver = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]") ?? null;
      if (el && el !== currentEl.current) schedule(el);
    };
    const onOut = (e: PointerEvent) => {
      const el = currentEl.current;
      if (!el) return;
      const related = e.relatedTarget as Node | null;
      if (related && el.contains(related)) return;
      hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]") ?? null;
      if (el) schedule(el);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };

    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", hide, true);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      clearTimer();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  // Measure the rendered bubble, then flip above/below and clamp to the viewport
  // so it never clips.
  useLayoutEffect(() => {
    if (!tip || !bubbleRef.current) return;
    const b = bubbleRef.current.getBoundingClientRect();
    const r = tip.rect;
    const below = r.bottom + GAP;
    const flipAbove =
      below + b.height > window.innerHeight - EDGE &&
      r.top - GAP - b.height >= EDGE;
    const top = flipAbove ? r.top - GAP - b.height : below;
    const centered = r.left + r.width / 2 - b.width / 2;
    const left = Math.max(
      EDGE,
      Math.min(centered, window.innerWidth - b.width - EDGE),
    );
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;

  return createPortal(
    <div
      ref={bubbleRef}
      role="tooltip"
      style={{
        position: "fixed",
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        zIndex: 1000,
        maxWidth: MAX_WIDTH,
        padding: "5px 8px",
        borderRadius: 7,
        background: "var(--c-panel)",
        border: "1px solid var(--c-border)",
        color: "var(--c-text)",
        boxShadow: "0 8px 24px rgba(0,0,0,.35)",
        pointerEvents: "none",
        lineHeight: 1.35,
        // Hidden until measured so there is no first-frame flash at (0,0).
        opacity: pos ? 1 : 0,
        transition: reduceMotion ? undefined : "opacity .1s",
        ...f(500, 12, "body", { whiteSpace: "normal" }),
      }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
