import type { Env } from "./types";

export const VOICE_PROMPT_GUARD_MODEL = "@cf/meta/llama-guard-3-8b";
export const VOICE_PROMPT_GUARD_TIMEOUT_MS = 10_000;

export const VOICE_SAFETY_CATEGORIES = {
  S1: "Violent crimes",
  S2: "Non-violent crimes",
  S3: "Sex-related crimes",
  S4: "Child sexual exploitation",
  S5: "Defamation",
  S6: "Specialized advice",
  S7: "Privacy violations",
  S8: "Intellectual property",
  S9: "Indiscriminate weapons",
  S10: "Hate speech",
  S11: "Suicide and self-harm",
  S12: "Sexual content",
  S13: "Elections",
  S14: "Code interpreter abuse",
} as const;

export type VoiceSafetyCategory = keyof typeof VOICE_SAFETY_CATEGORIES;

export type VoicePromptCheck =
  | { safe: true }
  | { safe: false; message: string; categories: VoiceSafetyCategory[] };

export interface VoicePromptAIRunner {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

function isSafetyCategory(value: string): value is VoiceSafetyCategory {
  return Object.hasOwn(VOICE_SAFETY_CATEGORIES, value);
}

export function parseVoicePromptGuardOutput(output: string): VoicePromptCheck {
  const trimmed = output.trim();
  if (!trimmed) throw new Error("Empty response from LlamaGuard");
  if (trimmed.toLowerCase() === "safe") return { safe: true };

  const [status, categoryLine = ""] = trimmed.split(/\r?\n/, 2);
  if (status.toLowerCase() !== "unsafe") {
    throw new Error("Unexpected response from LlamaGuard");
  }

  const categories = categoryLine
    .split(",")
    .map((category) => category.trim())
    .filter(isSafetyCategory);
  const labels = categories.map((category) => VOICE_SAFETY_CATEGORIES[category]);

  return {
    safe: false,
    message: labels.length > 0 ? `Blocked for: ${labels.join(", ").toLowerCase()}.` : "Blocked by safety guardrails.",
    categories,
  };
}

function responseText(response: unknown): string {
  if (!response || typeof response !== "object" || !("response" in response)) {
    throw new Error("Invalid response from LlamaGuard");
  }
  const value = response.response;
  if (typeof value !== "string") throw new Error("Invalid response from LlamaGuard");
  return value;
}

export async function checkVoicePrompt(
  env: Pick<Env, "AI">,
  text: string,
  runner: VoicePromptAIRunner = env.AI,
): Promise<VoicePromptCheck> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("LlamaGuard timeout")), VOICE_PROMPT_GUARD_TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([
      runner.run(VOICE_PROMPT_GUARD_MODEL, {
        messages: [{ role: "user", content: text }],
      }),
      timeout,
    ]);
    return parseVoicePromptGuardOutput(responseText(response));
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
