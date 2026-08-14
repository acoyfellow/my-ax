import type { AccessIdentity } from "./auth";

export const VOICE_STT_KEYTERMS = [
  "Workers",
  "Durable Objects",
  "R2",
  "KV",
  "D1",
  "Workers AI",
  "Access",
  "Zero Trust",
  "Pages",
  "Queues",
  "Vectorize",
  "AI Gateway",
  "Cloudflare",
  "Turnstile",
  "WAF",
  "Cloudflare One",
] as const;

export const VOICE_CALL_GREETING = "Hi, I'm ready to help.";

export type VoiceThinkConfig = { identity?: AccessIdentity; sessionId?: string };

export function lockVoiceThinkConfig(
  existing: VoiceThinkConfig | undefined,
  incoming: VoiceThinkConfig,
): Required<VoiceThinkConfig> {
  const identity = incoming.identity;
  const sessionId = incoming.sessionId?.trim();
  if (!identity?.email || !identity.sub || !sessionId) {
    throw new Error("Voice session identity and session ID are required.");
  }
  const normalized = {
    identity: { ...identity, email: identity.email.toLowerCase() },
    sessionId,
  };
  if (!existing?.identity || !existing.sessionId) return normalized;
  if (
    existing.identity.email.toLowerCase() !== normalized.identity.email ||
    existing.identity.sub !== normalized.identity.sub ||
    existing.sessionId !== normalized.sessionId
  ) {
    throw new Error("Voice session identity cannot change once linked.");
  }
  return normalized;
}

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
