export const TERMINAL_DEFAULT_COLS = 80;
export const TERMINAL_DEFAULT_ROWS = 24;
export const TERMINAL_MAX_COLS = 500;
export const TERMINAL_MAX_ROWS = 200;
export const TERMINAL_MIN_LIVE_COLS = 40;

export function usableTerminalGrid(cols: number, rows: number): boolean {
  return Number.isInteger(cols) && Number.isInteger(rows) && cols >= TERMINAL_MIN_LIVE_COLS && rows > 0 && cols <= TERMINAL_MAX_COLS && rows <= TERMINAL_MAX_ROWS;
}

export type TerminalControlFrame = { type: "resize"; cols: number; rows: number };

export function boundedDimension(raw: string | null | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function terminalDimensions(query: { cols?: string | null; rows?: string | null }): { cols: number; rows: number } {
  return {
    cols: boundedDimension(query.cols, TERMINAL_DEFAULT_COLS, TERMINAL_MAX_COLS),
    rows: boundedDimension(query.rows, TERMINAL_DEFAULT_ROWS, TERMINAL_MAX_ROWS),
  };
}

export function isWebSocketUpgrade(upgradeHeader: string | null | undefined): boolean {
  return upgradeHeader?.toLowerCase() === "websocket";
}

export function encodeKeystrokes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function resizeFrame(cols: number, rows: number): string {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
    throw new Error("a resize frame needs positive integer dimensions");
  }
  return JSON.stringify({ type: "resize", cols, rows } satisfies TerminalControlFrame);
}

export function isStatusFrame(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  try {
    const parsed = JSON.parse(raw) as { type?: unknown };
    return parsed.type === "ready" || parsed.type === "error";
  } catch {
    return false;
  }
}
