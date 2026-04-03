const WS_URL = "ws://localhost:7890";
const RECONNECT_INTERVAL_MS = 3000;

export type WsMessage =
  | { type: "SET_SUBTITLES"; payload: Subtitle[] }
  | { type: "HELLO"; payload: { client: string } };

export interface Subtitle {
  id: string;
  index: number;
  startTime: number; // ms
  endTime: number;   // ms
  text: string;
  words: { text: string; startTime: number; endTime: number }[];
  speaker?: string;
}

type MessageHandler = (msg: WsMessage) => void;
type StatusHandler = (connected: boolean) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    private onMessage: MessageHandler,
    private onStatus: StatusHandler
  ) {
    this.connect();
  }

  private connect() {
    if (this.destroyed) return;

    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      this.onStatus(true);
      this.send({ type: "HELLO", payload: { client: "premiere-uxp-plugin" } });
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        this.onMessage(msg);
      } catch {
        // ignore malformed
      }
    };

    this.ws.onclose = () => {
      this.onStatus(false);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_INTERVAL_MS);
  }

  send(msg: WsMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
