import type { VoiceCommand } from "./voice-grammar";

export type VoiceEffect =
  | { type: "event"; name: string; detail?: Record<string, unknown> }
  | { type: "desk"; kind: "approve" | "dismiss"; card: number };

const OPEN_EVENTS: Record<"desk" | "root" | "attention" | "settings", string> = {
  desk: "my-ax:desk-open",
  root: "my-ax:root-open",
  attention: "my-ax:attention-open",
  settings: "my-ax:settings-open",
};

export function voiceEffect(command: VoiceCommand): VoiceEffect {
  if (command.kind === "open") return { type: "event", name: OPEN_EVENTS[command.target] };
  if (command.kind === "stop") return { type: "event", name: "my-ax:voice-stop" };
  if (command.kind === "ask") return { type: "event", name: "my-ax:voice-ask", detail: { text: command.text } };
  return { type: "desk", kind: command.kind, card: command.card };
}

export function voiceSummary(command: VoiceCommand): string {
  if (command.kind === "open") return `Open ${command.target}`;
  if (command.kind === "stop") return "Stop the agent";
  if (command.kind === "ask") return `Ask: ${command.text}`;
  return `${command.kind === "approve" ? "Approve" : "Dismiss"} desk card ${command.card}`;
}

export type PendingConfirm = { command: VoiceCommand; heard: string; expiresAt: number };

export const CONFIRM_WINDOW_MS = 8000;

export function confirmStillValid(pending: PendingConfirm | null, now: number): pending is PendingConfirm {
  return pending !== null && now <= pending.expiresAt;
}
