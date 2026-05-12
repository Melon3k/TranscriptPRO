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
