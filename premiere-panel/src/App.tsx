import { useEffect, useRef, useState } from "react";
import { WsClient, Subtitle } from "./ws-client";

// UXP / Premiere Pro API — available at runtime inside Premiere
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (module: string) => any;

// 1 second = 254,016,000,000 ticks in Premiere Pro
const TICKS_PER_MS = 254_016_000;

async function applySubtitlesToPremiere(subtitles: Subtitle[]) {
  try {
    const ppro = require("premierepro/app");
    const sequence = await ppro.getActiveSequence();
    if (!sequence) return { ok: false, error: "No active sequence" };

    const tracks = await sequence.getCaptionTracks();
    let track = tracks.length > 0 ? tracks[0] : null;

    if (!track) {
      track = await sequence.createCaptionTrack("SubRip (.srt)");
    }

    // Remove existing captions
    const existing = await track.getCaptions();
    for (const cap of existing) {
      await track.removeCaption(cap);
    }

    // Add new captions
    for (const sub of subtitles) {
      const startTicks = Math.round(sub.startTime * TICKS_PER_MS);
      const endTicks = Math.round(sub.endTime * TICKS_PER_MS);
      await track.addCaption(sub.text, startTicks, endTicks);
    }

    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [subtitleCount, setSubtitleCount] = useState<number | null>(null);
  const [status, setStatus] = useState("Connecting...");
  const clientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    const client = new WsClient(
      async (msg) => {
        if (msg.type === "SET_SUBTITLES") {
          setSubtitleCount(msg.payload.length);
          setStatus("Applying to timeline...");
          const result = await applySubtitlesToPremiere(msg.payload);
          setStatus(result.ok ? `Applied ${msg.payload.length} subtitles` : `Error: ${result.error}`);
        }
      },
      (isConnected) => {
        setConnected(isConnected);
        setStatus(isConnected ? "Connected to TranscriptPRO" : "Reconnecting...");
        if (!isConnected) setSubtitleCount(null);
      }
    );
    clientRef.current = client;
    return () => client.destroy();
  }, []);

  const handleSendBack = () => {
    // Future: read captions from Premiere and push back via WS
    setStatus("Send back not yet implemented");
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>TranscriptPRO</span>
        <span style={{ ...styles.dot, background: connected ? "#4ade80" : "#facc15" }} />
      </div>

      <div style={styles.statusBox}>
        <p style={styles.statusText}>{status}</p>
        {subtitleCount !== null && (
          <p style={styles.count}>{subtitleCount} subtitles</p>
        )}
      </div>

      {connected && (
        <button style={styles.btn} onClick={handleSendBack}>
          Send back to TranscriptPRO
        </button>
      )}

      {!connected && (
        <p style={styles.hint}>
          Make sure TranscriptPRO app is running on this machine.
        </p>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    height: "100vh",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontWeight: 600,
    fontSize: 13,
    color: "#e2e8f0",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    flexShrink: 0,
  },
  statusBox: {
    background: "#2d2d2d",
    borderRadius: 6,
    padding: "10px 12px",
  },
  statusText: {
    color: "#a0aec0",
    lineHeight: 1.4,
  },
  count: {
    marginTop: 4,
    color: "#4ade80",
    fontWeight: 500,
  },
  btn: {
    background: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
  },
  hint: {
    color: "#718096",
    fontSize: 11,
    lineHeight: 1.5,
  },
};
