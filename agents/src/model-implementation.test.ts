import assert from "node:assert/strict";
import test from "node:test";
import { applyModelEdits, createImplementationModel, jsonObject, validateModelImplementation } from "./model-implementation";

test("model JSON parsing stops at the first balanced object", () => {
  assert.deepEqual(jsonObject('preface {"value":"}"} trailing {"ignored":true}'), { value: "}" });
  assert.throws(() => jsonObject('{"value":'), /incomplete JSON object/);
});

test("the implementation model rejects a disconnected helper", () => {
  assert.throws(() => validateModelImplementation([
    { path: "src/ui/new-helper.ts", content: "export {};\n" },
    { path: "src/ui/new-helper.test.ts", content: "export {};\n" },
  ], ["src/ui/Chat.svelte"]), /existing product file/);
  assert.throws(() => validateModelImplementation([
    { path: "src/ui/chat-composer-smoke.mjs", content: "export {};\n" },
    { path: "src/ui/new-helper.test.ts", content: "export {};\n" },
  ], ["src/ui/chat-composer-smoke.mjs"]), /existing product file/);
  assert.throws(() => validateModelImplementation([
    { path: "src/ui/Chat.svelte", content: "product" },
    { path: "src/ui/Chat.test.ts", content: "import { test } from 'vitest';\n" },
  ], ["src/ui/Chat.svelte"]), /vitest is not installed/);
});

test("model edits cannot truncate an existing product file", () => {
  const context = [{ path: "src/ui/Chat.svelte", content: "before\nunique target\nafter\n" }];
  assert.throws(() => applyModelEdits({ edits: [{ path: "src/ui/Chat.svelte", content: "short" }] }, context), /bounded replacements/);
  assert.throws(() => applyModelEdits({ edits: [{ path: "src/ui/Chat.svelte", replacements: [{ oldText: "missing", newText: "x" }] }] }, context), /exactly once/);
});

test("each changed product file needs a related focused test", () => {
  assert.throws(() => validateModelImplementation([
    { path: "src/agentcast-tools.ts", content: "export {};\n" },
    { path: "src/agentcast-tools.test.ts", content: "export {};\n" },
    { path: "src/session-title.ts", content: "export {};\n" },
  ], ["src/agentcast-tools.ts", "src/agentcast-tools.test.ts", "src/session-title.ts"]), /own focused test: src\/session-title.ts/);
});

test("existing files cannot lose most of their coverage or implementation", () => {
  const context = [{ path: "src/feature.test.ts", content: "x".repeat(100) }];
  assert.throws(() => applyModelEdits({ edits: [{
    path: "src/feature.test.ts",
    replacements: [{ oldText: "x".repeat(80), newText: "" }],
  }] }, context), /may not delete more than 25%/);
});

test("changed chat smoke assertions must match the resulting source", () => {
  const context = [
    { path: "src/ui/Chat.svelte", content: "const active = true;\n" },
    { path: "src/ui/chat-composer-smoke.mjs", content: "assertIncludes(chat, \"active\", \"active marker\");\n" },
  ];
  assert.throws(() => applyModelEdits({ edits: [
    { path: "src/ui/Chat.svelte", replacements: [{ oldText: "true", newText: "false" }] },
    { path: "src/ui/chat-composer-smoke.mjs", replacements: [{ oldText: "active marker", newText: "marker" }, { oldText: "active\",", newText: "TURN_STALL_MS\"," }] },
  ] }, context), /absent from resulting source: TURN_STALL_MS/);
});

test("a Chat edit must satisfy the existing chat smoke even when the model omits it", () => {
  const context = [
    { path: "src/ui/Chat.svelte", content: "const active = true;\n" },
    { path: "src/ui/chat-composer-smoke.mjs", content: "assertIncludes(chat, \"TURN_STALL_MS\", \"stall marker\");\n" },
  ];
  assert.throws(() => applyModelEdits({ edits: [
    { path: "src/ui/Chat.svelte", replacements: [{ oldText: "true", newText: "false" }] },
    { path: "src/ui/recovery.test.ts", content: "import test from 'node:test'; test('recovery', () => {});\n" },
  ] }, context), /absent from resulting source: TURN_STALL_MS/);
});

test("chat smoke validation decodes escaped newlines before comparing source", () => {
  const context = [
    { path: "src/ui/Chat.svelte", content: "const marker = true;\nline two\n" },
    { path: "src/ui/chat-composer-smoke.mjs", content: "assertIncludes(chat, \"const marker = false;\\nline two\", \"multiline marker\");\n" },
  ];
  assert.doesNotThrow(() => applyModelEdits({ edits: [
    { path: "src/ui/Chat.svelte", replacements: [{ oldText: "true", newText: "false" }] },
    { path: "src/ui/recovery.test.ts", content: "import test from 'node:test'; test('recovery', () => {});\n" },
  ] }, context));
});

test("the implementation model selects context and returns bounded source with tests", async () => {
  const originalFetch = globalThis.fetch;
  const prompts: string[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body || "{}")) as { input?: string };
    prompts.push(request.input || "");
    const text = prompts.length === 1
      ? JSON.stringify({ paths: ["src/ui/message.ts", "src/ui/message.test.ts", ".github/workflows/deploy.yml"] })
      : JSON.stringify({ edits: [
          { path: "src/ui/message.ts", replacements: [{ oldText: "content of src/ui/message.ts", newText: "export const text = 'hello';\n" }] },
          { path: "src/ui/message.test.ts", replacements: [{ oldText: "content of src/ui/message.test.ts", newText: "export {};\n" }] },
        ] });
    return Response.json({ output: [{ content: [{ type: "output_text", text }] }] });
  }) as typeof fetch;
  try {
    const model = createImplementationModel({
      LLM_GATEWAY_URL: "https://gateway.example/openai",
      LLM_GATEWAY_TOKEN: "token",
      LLM_GATEWAY_AUTH_HEADER: "cf-access-token",
    }, "gpt-5.6-terra");
    const files = await model.implement!({
      number: 184,
      title: "bug: leading space",
      body: "hello renders with one leading space",
      author: "owner",
    }, {
      paths: ["src/ui/message.ts", "src/ui/message.test.ts", ".github/workflows/deploy.yml"],
      async read(path) { return `content of ${path}`; },
    });
    assert.deepEqual(files.map((file) => file.path), ["src/ui/message.ts", "src/ui/message.test.ts"]);
    assert.equal(prompts.length, 2);
    assert.doesNotMatch(prompts[1]!, /\.github\/workflows\/deploy\.yml/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
