import { useEffect, useRef, useState } from "react";
import { WsClient, Subtitle } from "./ws-client";

// UXP / Premiere Pro API — available at runtime inside Premiere
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: (module: string) => any;

function subtitlesToSrt(subtitles: Subtitle[]): string {
  return subtitles
    .map((sub, i) => {
      const fmt = (ms: number) => {
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        const ml = ms % 1000;
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ml).padStart(3, "0")}`;
      };
      return `${i + 1}\n${fmt(sub.startTime)} --> ${fmt(sub.endTime)}\n${sub.text}\n`;
    })
    .join("\n");
}

async function applySubtitlesToPremiere(subtitles: Subtitle[]) {
  try {
    const ppro = require("premierepro");
    const storage = require("uxp").storage;
    const lfs = storage.localFileSystem;

    const project = await ppro.Project.getActiveProject();
    if (!project) return { ok: false, error: "No active project" };

    // Write SRT to temp folder
    const tempFolder = await lfs.getTemporaryFolder();
    const srtFile = await tempFolder.createFile("transcriptpro_sync.srt", { overwrite: true });
    const srtContent = subtitlesToSrt(subtitles);
    await srtFile.write(srtContent);

    const srtPath = srtFile.nativePath;
    console.log("[TranscriptPRO] SRT written to:", srtPath);

    // Import SRT into Premiere project
    await project.importFiles([srtPath]);
    console.log("[TranscriptPRO] importFiles succeeded");

    return { ok: true, error: null };
  } catch (e) {
    console.error("[TranscriptPRO] error:", e);
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
          setStatus("Importing to project...");
          const result = await applySubtitlesToPremiere(msg.payload);
          setStatus(
            result.ok
              ? `Imported ${msg.payload.length} subtitles`
              : `Error: ${result.error}`
          );
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
    setStatus("Send back not yet implemented");
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>TranscriptPRO</span>
        <span
          style={{ ...styles.dot, background: connected ? "#4ade80" : "#facc15" }}
        />
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
