export const VOICE_STATUSES = ["idle", "listening", "thinking", "speaking"] as const;

export type VoiceStatus = (typeof VOICE_STATUSES)[number];

export function isVoiceStatus(value: unknown): value is VoiceStatus {
  return typeof value === "string" && (VOICE_STATUSES as readonly string[]).includes(value);
}

export function isAgentTurn(status: VoiceStatus): boolean {
  return status === "thinking" || status === "speaking";
}

export function nextVoiceStatus(current: VoiceStatus, reported: unknown): VoiceStatus {
  return isVoiceStatus(reported) ? reported : current;
}
