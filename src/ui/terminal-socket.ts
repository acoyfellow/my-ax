export const TERMINAL_ENDPOINT = "/api/workspace/terminal";
export const TERMINAL_RECONNECT_DELAY_MS = 1200;

export type TerminalStatus = "connecting" | "ready" | "closed" | "error";

export interface TerminalSocketHooks {
  onBytes: (bytes: Uint8Array) => void;
  onStatus: (status: TerminalStatus, detail?: string) => void;
  openSocket?: (url: string) => WebSocket;
}

export function terminalUrl(origin: string, cols: number, rows: number): string {
  const base = origin.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  return `${base}${TERMINAL_ENDPOINT}?cols=${cols}&rows=${rows}`;
}

export class TerminalSocket {
  private socket: WebSocket | null = null;
  private closedByCaller = false;

  constructor(private readonly hooks: TerminalSocketHooks) {}

  connect(url: string): void {
    this.closedByCaller = false;
    this.hooks.onStatus("connecting");
    const socket = this.hooks.openSocket ? this.hooks.openSocket(url) : new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onmessage = (event: MessageEvent) => this.receive(event.data);
    socket.onerror = () => this.hooks.onStatus("error", "the terminal connection failed");
    socket.onclose = () => {
      this.socket = null;
      this.hooks.onStatus("closed", this.closedByCaller ? undefined : "the terminal connection closed");
    };
  }

  private receive(data: unknown): void {
    if (typeof data === "string") {
      try {
        const frame = JSON.parse(data) as { type?: string; message?: string };
        if (frame.type === "ready") this.hooks.onStatus("ready");
        else if (frame.type === "error") this.hooks.onStatus("error", frame.message ?? "the terminal reported an error");
      } catch {
        this.hooks.onStatus("error", "the terminal sent an unreadable status frame");
      }
      return;
    }
    if (data instanceof ArrayBuffer) {
      this.hooks.onBytes(new Uint8Array(data));
      return;
    }
    if (data instanceof Uint8Array) this.hooks.onBytes(data);
  }

  send(bytes: Uint8Array): boolean {
    if (!this.socket || this.socket.readyState !== 1) return false;
    this.socket.send(bytes);
    return true;
  }

  resize(cols: number, rows: number): boolean {
    if (!this.socket || this.socket.readyState !== 1) return false;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) return false;
    this.socket.send(JSON.stringify({ type: "resize", cols, rows }));
    return true;
  }

  close(): void {
    this.closedByCaller = true;
    this.socket?.close();
    this.socket = null;
  }
}
