import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { recordingAvailable } from "./tool-result-widgets";

const read = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

test("a browser recording is checked once per page, however often the chat re-renders", async () => {
  let calls = 0;
  const load = (async () => { calls += 1; return new Response("{}", { status: 200 }); }) as typeof fetch;
  const href = `/api/browser/recordings/${crypto.randomUUID()}`;
  const results = await Promise.all(Array.from({ length: 50 }, () => recordingAvailable(href, load)));
  assert.equal(calls, 1);
  assert.ok(results.every(Boolean));
});

test("a missing recording is remembered as missing", async () => {
  let calls = 0;
  const load = (async () => { calls += 1; return new Response("{}", { status: 502 }); }) as typeof fetch;
  const href = `/api/browser/recordings/${crypto.randomUUID()}`;
  assert.equal(await recordingAvailable(href, load), false);
  assert.equal(await recordingAvailable(href, load), false);
  assert.equal(calls, 1);
});

test("the replay check runs from a derived href, not from every new result object", () => {
  const widget = read("./ToolResultWidget.svelte");
  assert.match(widget, /let recordingHref = \$derived\(/);
  assert.match(widget, /recordingAvailable\(href\)/);
  assert.doesNotMatch(widget, /fetch\(href/);
});

test("opening a chat warms only a few recent chats, when the phone is idle and visible", () => {
  const chat = read("./Chat.svelte");
  assert.match(chat, /const PREFETCH_CHAT_LIMIT = 6;/);
  assert.match(chat, /whenIdle\(\(\) => void prefetchRecentChats\(\)\)/);
  assert.match(chat, /document\.visibilityState !== "visible"\) return;/);
  assert.doesNotMatch(chat, /setTimeout\(\(\) => void prefetchRecentChats\(\), 1500\)/);
});

test("the viewport debug probe only runs while debug is on", () => {
  const app = read("./BetaApp.svelte");
  assert.match(app, /if \(!on\) return;\n\s*measure\(\);\n\s*id = setInterval\(measure, 500\);/);
  assert.match(app, /sync\(startOn\);/);
});
