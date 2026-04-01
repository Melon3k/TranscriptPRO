import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { usePremiereStore } from "../stores/premiereStore";
import { useSubtitleStore } from "../stores/subtitleStore";
import { startWsServer, pushSubtitlesToPremiere } from "../lib/tauri-commands";

export function usePremiereConnection() {
  const { setStatus, setError } = usePremiereStore();
  const { setSubtitles } = useSubtitleStore();

  useEffect(() => {
    // Start the WebSocket server when the app mounts
    startWsServer().catch((e) => {
      setError(`Failed to start WS server: ${e}`);
    });

    const unlisteners: Array<() => void> = [];

    const setup = async () => {
      unlisteners.push(
        await listen("ws-server-started", () => {
          setStatus("server-running");
        })
      );

      unlisteners.push(
        await listen("ws-client-connected", () => {
          setStatus("plugin-connected");
        })
      );

      unlisteners.push(
        await listen("ws-client-disconnected", () => {
          setStatus("server-running");
        })
      );

      unlisteners.push(
        await listen<string>("ws-message-received", (event) => {
          try {
            const msg = JSON.parse(event.payload);
            if (msg.type === "SET_SUBTITLES" && Array.isArray(msg.payload)) {
              setSubtitles(msg.payload);
            }
          } catch {
            // Ignore malformed messages
          }
        })
      );
    };

    setup();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [setStatus, setError, setSubtitles]);

  const sendSubtitles = async (subtitles: Parameters<typeof pushSubtitlesToPremiere>[0]) => {
    await pushSubtitlesToPremiere(subtitles);
  };

  return { sendSubtitles };
}
