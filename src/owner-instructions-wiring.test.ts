import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("every turn reloads owner instructions and composes them with protected and cached policy", async () => {
  const agent = await source("./agent.ts");
  assert.match(agent, /beforeTurn\(ctx:.*system\?: string/);
  assert.match(agent, /getOwnerInstructions\(this\.env, identity\.email\)/);
  assert.match(agent, /instructions: composeOwnerSystemPrompt\(PUBLIC_SYSTEM, ctx\.system, ownerInstructions\)/);
});

test("authenticated preference routes are registered without session fan-out", async () => {
  const [index, routes] = await Promise.all([source("./index.tsx"), source("./routes/instructions.ts")]);
  assert.match(index, /registerInstructionRoutes\(app\)/);
  assert.match(routes, /app\.get\("\/api\/instructions"/);
  assert.match(routes, /app\.put\("\/api\/instructions"/);
  assert.match(routes, /app\.post\("\/api\/instructions\/reset"/);
  assert.doesNotMatch(routes, /getSessionAgent|seedIdentity|SELECT id FROM sessions/);
});

test("Settings loads, saves, and resets owner instructions", async () => {
  const settings = await source("./ui/Settings.svelte");
  assert.match(settings, /void refreshOwnerInstructions\(\)/);
  assert.match(settings, /fetch\("\/api\/instructions"/);
  assert.match(settings, /fetch\("\/api\/instructions\/reset"/);
  assert.match(settings, /maxlength="4000"/);
  assert.match(settings, /Protected policy, authorization, tool limits, and verification rules cannot be changed here\./);
});
