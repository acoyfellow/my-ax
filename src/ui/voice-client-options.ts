import type { VoiceClientOptions } from "@cloudflare/voice/client";

export const VOICE_CLIENT_OPTIONS = {
  interruptThreshold: 0.09,
  interruptChunks: 2,
} as const satisfies Pick<VoiceClientOptions, "interruptThreshold" | "interruptChunks">;
