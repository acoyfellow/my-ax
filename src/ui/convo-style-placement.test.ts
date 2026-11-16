import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");
const shell = readFileSync(new URL("./AppShell.svelte", import.meta.url), "utf8");
const picker = readFileSync(new URL("./ConvoStylePicker.svelte", import.meta.url), "utf8");

test("the reply style picker lives in the app bar, not in the composer", () => {
  assert.doesNotMatch(chat, /<ConvoStylePicker/);
  assert.match(shell, /\{#if sessionState\.id\}<ConvoStylePicker getSessionId=\{\(\) => sessionState\.id \?\? ""\} \/>\{\/if\}/);
});

test("the picker tells Chat the style through one window event", () => {
  assert.match(picker, /new CustomEvent\("my-ax:convo-style"/);
  assert.match(chat, /window\.addEventListener\("my-ax:convo-style", onConvoStyle\)/);
});

test("each menu row shows the style's while-working tag", () => {
  assert.match(picker, /data-convo-style-while=\{spec\.midTurn\}/);
  assert.match(picker, /\{spec\.whileWorking\}/);
});

test("mid-turn notes say what happened in one tag, with no second explanation line", () => {
  assert.match(chat, /"Joins next step"/);
  assert.doesNotMatch(chat, /It reaches the agent after its current step\./);
  assert.doesNotMatch(chat, /Answering while it works/);
});
