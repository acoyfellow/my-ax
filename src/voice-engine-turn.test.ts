import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

test("voice turns route pi sessions to the pi chat and wait for its reply", () => {
  const source = readFileSync(new URL("./voice-think-agent.ts", import.meta.url), "utf8");
  assert.match(source, /engine === "pi"/);
  assert.match(source, /chat\.submit\(transcript\)/);
  assert.match(source, /chat\.wait\(receipt\.operationId\)/);
});

test("starting voice in a new conversation creates the same session kind as typing", () => {
  const source = readFileSync(new URL("./ui/Chat.svelte", import.meta.url), "utf8");
  assert.doesNotMatch(source, /createThinkSession/);
});
