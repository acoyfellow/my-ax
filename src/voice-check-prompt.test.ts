import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "./types";
import {
  checkVoicePrompt,
  VOICE_PROMPT_GUARD_MODEL,
  type VoicePromptAIRunner,
} from "./voice-check-prompt";

function testEnv(ai: VoicePromptAIRunner): Pick<Env, "AI"> {
  return { AI: ai } as unknown as Pick<Env, "AI">;
}

function runner(response: string): { runner: VoicePromptAIRunner; calls: Array<{ model: string; input: Record<string, unknown> }> } {
  const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
  return {
    calls,
    runner: {
      async run(model, input) {
        calls.push({ model, input });
        return { response };
      },
    },
  };
}

test("voice prompt guard accepts safe output through an injected AI runner", async () => {
  const mocked = runner(" safe\n");
  const result = await checkVoicePrompt(testEnv(mocked.runner), "Explain Workers.", mocked.runner);

  assert.deepEqual(result, { safe: true });
  assert.deepEqual(mocked.calls, [
    {
      model: VOICE_PROMPT_GUARD_MODEL,
      input: { messages: [{ role: "user", content: "Explain Workers." }] },
    },
  ]);
});

test("voice prompt guard fails closed when LlamaGuard throws or times out", async () => {
  const throwing: VoicePromptAIRunner = {
    async run() { throw new Error("LlamaGuard timeout"); },
  };
  await assert.rejects(() => checkVoicePrompt(testEnv(throwing), "hi", throwing), /timeout|LlamaGuard/);
});

test("voice prompt guard reports only recognized unsafe categories", async () => {
  const mocked = runner("unsafe\nS1, S11, S99");
  const result = await checkVoicePrompt(testEnv(mocked.runner), "unsafe request", mocked.runner);

  assert.deepEqual(result, {
    safe: false,
    message: "Blocked for: violent crimes, suicide and self-harm.",
    categories: ["S1", "S11"],
  });
});
