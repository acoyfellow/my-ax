import type { AccessIdentity } from "./auth";

export type VoiceThinkConfig = { identity?: AccessIdentity; sessionId?: string };

export function parseVoiceThinkAgentName(name: string): VoiceThinkConfig | null {
  const separator = name.indexOf(":");
  if (separator <= 0 || separator === name.length - 1) return null;
  const email = name.slice(0, separator).trim().toLowerCase();
  const sessionId = name.slice(separator + 1).trim();
  if (!email || !sessionId || !email.includes("@")) return null;
  return { identity: { email, sub: email }, sessionId };
}

export function resolveVoiceThinkConfig(state: VoiceThinkConfig | undefined, actorName: string): VoiceThinkConfig {
  if (state?.identity?.email && state.sessionId) return state;
  return parseVoiceThinkAgentName(actorName) ?? {};
}
