import { Data, Effect } from "effect";
import { VOICE_PROMPT_GUARD_MODEL, VOICE_PROMPT_GUARD_TIMEOUT_MS, parseVoicePromptGuardOutput, type VoicePromptAIRunner, type VoicePromptCheck } from "./voice-check-prompt";

export class VoicePromptGuardError extends Data.TaggedError("VoicePromptGuardError")<{
  cause: unknown;
}> {
  override get message(): string {
    return this.cause instanceof Error ? this.cause.message : String(this.cause);
  }
}

function responseText(response: unknown): string {
  if (!response || typeof response !== "object" || !("response" in response)) throw new Error("Invalid response from LlamaGuard");
  const value = response.response;
  if (typeof value !== "string") throw new Error("Invalid response from LlamaGuard");
  return value;
}

export function checkVoicePromptEffect(
  text: string,
  runner: VoicePromptAIRunner,
): Effect.Effect<VoicePromptCheck, VoicePromptGuardError> {
  return Effect.tryPromise({
    try: () => runner.run(VOICE_PROMPT_GUARD_MODEL, { messages: [{ role: "user", content: text }] }),
    catch: (cause) => new VoicePromptGuardError({ cause }),
  }).pipe(
    Effect.timeout(VOICE_PROMPT_GUARD_TIMEOUT_MS),
    Effect.map((response) => parseVoicePromptGuardOutput(responseText(response))),
    Effect.catch((cause) => Effect.fail(new VoicePromptGuardError({ cause }))),
  );
}
