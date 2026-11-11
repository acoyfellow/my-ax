export const COMPUTER_EXEC_MAX_MS = 110_000;
export const COMPUTER_EXEC_OUTPUT_CHARS = 12_000;

export type ComputerInput =
  | { action: "click"; x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean }
  | { action: "move"; x: number; y: number }
  | { action: "type"; text: string }
  | { action: "key"; keys: string }
  | { action: "scroll"; x: number; y: number; dy: number };

const BUTTONS = { left: 1, middle: 2, right: 3 } as const;
const KEY_PATTERN = /^[A-Za-z0-9_+]{1,40}( [A-Za-z0-9_+]{1,40}){0,7}$/;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function pixel(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 8192) throw new Error(`${name} must be a pixel from 0 to 8192`);
  return Math.round(value);
}

export function parseComputerInput(raw: Record<string, unknown>): ComputerInput {
  switch (raw.action) {
    case "click": {
      const button = raw.button === "right" || raw.button === "middle" ? raw.button : "left";
      return { action: "click", x: pixel(raw.x, "x"), y: pixel(raw.y, "y"), button, double: raw.double === true };
    }
    case "move":
      return { action: "move", x: pixel(raw.x, "x"), y: pixel(raw.y, "y") };
    case "type": {
      if (typeof raw.text !== "string" || raw.text.length === 0 || raw.text.length > 2000) throw new Error("text must be 1 to 2000 characters");
      return { action: "type", text: raw.text };
    }
    case "key": {
      if (typeof raw.keys !== "string" || !KEY_PATTERN.test(raw.keys)) throw new Error("keys must be xdotool key names like ctrl+l Return");
      return { action: "key", keys: raw.keys };
    }
    case "scroll": {
      const dy = typeof raw.dy === "number" && Number.isFinite(raw.dy) ? Math.max(-50, Math.min(50, Math.round(raw.dy))) : 0;
      if (dy === 0) throw new Error("dy must be a non-zero number of wheel steps from -50 to 50");
      return { action: "scroll", x: pixel(raw.x, "x"), y: pixel(raw.y, "y"), dy };
    }
    default:
      throw new Error("action must be click, move, type, key or scroll");
  }
}

export function xdotoolCommand(input: ComputerInput): string {
  switch (input.action) {
    case "click":
      return `xdotool mousemove ${input.x} ${input.y} click ${input.double ? "--repeat 2 " : ""}${BUTTONS[input.button ?? "left"]}`;
    case "move":
      return `xdotool mousemove ${input.x} ${input.y}`;
    case "type":
      return `xdotool type --delay 12 -- ${shellQuote(input.text)}`;
    case "key":
      return `xdotool key ${input.keys}`;
    case "scroll":
      return `xdotool mousemove ${input.x} ${input.y} click --repeat ${Math.abs(input.dy)} ${input.dy > 0 ? 5 : 4}`;
  }
}

export function boundedExecTimeout(raw: unknown): number {
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : 60_000;
  return Math.max(1_000, Math.min(COMPUTER_EXEC_MAX_MS, Math.round(value)));
}

export function tailOutput(text: string | undefined): string {
  const value = text ?? "";
  return value.length > COMPUTER_EXEC_OUTPUT_CHARS ? `…${value.slice(-COMPUTER_EXEC_OUTPUT_CHARS)}` : value;
}
