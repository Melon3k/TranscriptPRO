import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface WordDragPayload {
  sourceSubId: string;
  wordIndices: number[];
}

/** insertAt === null means "no zone hovered — append at end of target segment" */
export interface WordDragHover {
  subId: string;
  insertAt: number | null;
}

export interface UseWordDrag {
  dragging: WordDragPayload | null;
  hover: WordDragHover | null;
  /** attach to the fixed-position ghost div; hook moves it imperatively via style.transform */
  ghostRef: React.RefObject<HTMLDivElement | null>;
  ghostLabel: string; // e.g. `word` or `word +2`
  /** call from a word chip's onPointerDown */
  startDrag: (e: React.PointerEvent, payload: WordDragPayload, label: string) => void;
}

const DRAG_THRESHOLD = 5;
const EDGE_ZONE = 28;
const EDGE_STEP = 12;

interface PendingDrag {
  startX: number;
  startY: number;
  payload: WordDragPayload;
  label: string;
}

export function useWordDrag(
  onDrop: (payload: WordDragPayload, targetSubId: string, insertAt?: number) => void,
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>,
): UseWordDrag {
  const [dragging, setDragging] = useState<WordDragPayload | null>(null);
  const [hover, setHover] = useState<WordDragHover | null>(null);
  const [ghostLabel, setGhostLabel] = useState("");
  const ghostRef = useRef<HTMLDivElement | null>(null);

  // onDrop lives in a ref so startDrag can keep a stable identity across renders
  // (SubtitleRow is memo'ized and receives it as a prop).
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const scrollRef = useRef(scrollContainerRef);
  scrollRef.current = scrollContainerRef;

  const pendingRef = useRef<PendingDrag | null>(null);
  const draggingRef = useRef(false);
  const hoverRef = useRef<WordDragHover | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const posRef = useRef({ x: 0, y: 0 });

  // On the threshold-crossing pointermove the ghost isn't mounted yet
  // (setDragging hasn't rendered), so position it from the stored coords as
  // soon as it appears — otherwise it sits at viewport (0,0) until the next
  // move event.
  useLayoutEffect(() => {
    if (dragging && ghostRef.current) {
      ghostRef.current.style.transform = `translate(${posRef.current.x + 14}px, ${posRef.current.y + 14}px)`;
    }
  }, [dragging]);

  const startDrag = useCallback(
    (e: React.PointerEvent, payload: WordDragPayload, label: string) => {
      if (e.button !== 0 || !e.isPrimary) return;
      // modified clicks are word-selection, never drags
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (pendingRef.current) return;

      pendingRef.current = { startX: e.clientX, startY: e.clientY, payload, label };

      const suppress = (ce: MouseEvent) => {
        ce.stopPropagation();
        ce.preventDefault();
      };
      let suppressArmed = false;
      let edgeRafId: number | null = null;

      const disarmSuppress = () => {
        // let the drag-terminating click be swallowed, then disarm so it can
        // never eat a later unrelated click
        setTimeout(() => {
          window.removeEventListener("click", suppress, { capture: true });
        }, 0);
      };

      const cleanup = (buttonStillHeld = false) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKeyDown);
        if (edgeRafId !== null) {
          cancelAnimationFrame(edgeRafId);
          edgeRafId = null;
        }
        if (suppressArmed) {
          if (buttonStillHeld) {
            // Escape/pointercancel: the button may still be down, so the click
            // fires only on the eventual release — keep the suppressor armed
            // until the next pointerup, then disarm.
            window.addEventListener("pointerup", disarmSuppress, { once: true });
          } else {
            disarmSuppress();
          }
        }
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        pendingRef.current = null;
        draggingRef.current = false;
        hoverRef.current = null;
        cleanupRef.current = null;
        setDragging(null);
        setHover(null);
      };
      cleanupRef.current = cleanup;

      const onMove = (me: PointerEvent) => {
        const pending = pendingRef.current;
        if (!pending) return;
        const x = me.clientX;
        const y = me.clientY;
        posRef.current = { x, y };

        if (!draggingRef.current) {
          if (Math.hypot(x - pending.startX, y - pending.startY) <= DRAG_THRESHOLD) return;
          draggingRef.current = true;
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
          window.addEventListener("click", suppress, { capture: true, once: true });
          suppressArmed = true;
          // Escape cancels — only listen while an actual drag is in flight
          window.addEventListener("keydown", onKeyDown);
          setDragging(pending.payload);
          setGhostLabel(pending.label);
        }

        if (ghostRef.current) {
          ghostRef.current.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
        }

        const hit = document
          .elementFromPoint(x, y)
          ?.closest<HTMLElement>("[data-word-zone],[data-word-row]");
        let next: WordDragHover | null = null;
        if (hit) {
          if (hit.dataset.wordZone !== undefined) {
            const rowEl = hit.closest<HTMLElement>("[data-word-row]");
            const subId = rowEl?.dataset.wordRow;
            if (subId) next = { subId, insertAt: Number(hit.dataset.wordZone) };
          } else {
            const subId = hit.dataset.wordRow;
            if (subId) next = { subId, insertAt: null };
          }
        }
        if (next && next.subId === pending.payload.sourceSubId) next = null;

        const prev = hoverRef.current;
        if (
          (prev === null) !== (next === null) ||
          (prev && next && (prev.subId !== next.subId || prev.insertAt !== next.insertAt))
        ) {
          hoverRef.current = next;
          setHover(next);
        }

        // Kick off the edge auto-scroll loop; it keeps scrolling on its own
        // while the (possibly stationary) pointer stays in the edge zone.
        if (edgeRafId === null) edgeRafId = requestAnimationFrame(edgeScrollTick);
      };

      const edgeScrollTick = () => {
        edgeRafId = null;
        if (!draggingRef.current) return;
        const container = scrollRef.current?.current;
        if (!container) return;
        const y = posRef.current.y;
        const rect = container.getBoundingClientRect();
        if (y < rect.top + EDGE_ZONE) container.scrollTop -= EDGE_STEP;
        else if (y > rect.bottom - EDGE_ZONE) container.scrollTop += EDGE_STEP;
        else return; // outside the edge zone — stop until the next pointermove
        edgeRafId = requestAnimationFrame(edgeScrollTick);
      };

      const onUp = () => {
        const pending = pendingRef.current;
        const drop = draggingRef.current ? hoverRef.current : null;
        if (pending && drop) {
          onDropRef.current(pending.payload, drop.subId, drop.insertAt ?? undefined);
        }
        cleanup();
      };

      const onCancel = () => cleanup(true);

      const onKeyDown = (ke: KeyboardEvent) => {
        if (ke.key === "Escape" && draggingRef.current) cleanup(true);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [],
  );

  useEffect(() => () => cleanupRef.current?.(), []);

  return { dragging, hover, ghostRef, ghostLabel, startDrag };
}
