import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * Subscribes to Tauri's window-level drag-drop events and returns hover
 * state (for visual feedback) plus invokes `onDrop` with the dropped file
 * paths.
 *
 * Tauri intercepts native file drops before they reach the DOM (good — we
 * can read absolute paths, not just File objects). The DOM-level
 * dragover/drop handlers do NOT fire for native drops; we listen to
 * `onDragDropEvent` on the webview instead.
 */
export function useFileDrop(onDrop: (paths: string[]) => void): { isDragging: boolean } {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    // Native drag-drop is a Tauri-only capability. When the same React UI runs
    // outside the desktop shell (the hosted web target), the Tauri internals are
    // absent and getCurrentWebview() throws — skip wiring rather than crash.
    if (typeof window === "undefined") {
      return;
    }
    if (!("__TAURI_INTERNALS__" in window)) {
      // Hosted-web target: no native drop routing, but we must still swallow
      // OS file drops or the browser navigates away from the app (discarding
      // unsaved edits).
      const swallow = (e: DragEvent) => e.preventDefault();
      window.addEventListener("dragover", swallow);
      window.addEventListener("drop", swallow);
      return () => {
        window.removeEventListener("dragover", swallow);
        window.removeEventListener("drop", swallow);
      };
    }
    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      switch (event.payload.type) {
        case "enter":
        case "over":
          setIsDragging(true);
          break;
        case "leave":
          setIsDragging(false);
          break;
        case "drop":
          setIsDragging(false);
          if (event.payload.paths?.length) {
            onDrop(event.payload.paths);
          }
          break;
      }
    });

    return () => {
      void unlistenPromise.then((u) => u());
    };
  }, [onDrop]);

  return { isDragging };
}
