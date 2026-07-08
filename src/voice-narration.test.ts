import assert from "node:assert/strict";
import test from "node:test";
import {
  toolNarrationPhrase,
  NarrationThrottle,
  StillWorkingTimer,
  WORK_ACK,
} from "./voice-narration";

test("toolNarrationPhrase maps known tools to code-free spoken phrases", () => {
  assert.equal(toolNarrationPhrase("work_code"), "writing and running some code");
  assert.equal(toolNarrationPhrase("create_svelte_artifact"), "building a small interactive view");
  assert.equal(toolNarrationPhrase("send_voice_message"), "preparing an audio clip");
  assert.equal(toolNarrationPhrase("search_conversations"), "checking our past conversations");
});

test("toolNarrationPhrase uses family prefixes and a safe fallback", () => {
  assert.equal(toolNarrationPhrase("browser_open"), "browsing the web");
  assert.equal(toolNarrationPhrase("machinectl_anything"), "working on your computer");
  assert.equal(toolNarrationPhrase("cmux_pi_prompt"), "steering a workspace");
  assert.equal(toolNarrationPhrase("totally_unknown_tool"), "running a tool");
  assert.equal(toolNarrationPhrase(""), "running a tool");
});

test("narration phrases never leak code/args (short, plain)", () => {
  for (const name of ["work_code", "machinectl_call", "browser_x", "unknown"]) {
    const phrase = toolNarrationPhrase(name);
    assert.ok(phrase.split(" ").length <= 8, `${name}: <=8 words`);
    assert.doesNotMatch(phrase, /[{}()<>/\\]|args|code:|path|token/i, `${name}: no code-ish content`);
  }
});

test("NarrationThrottle rate-limits and de-dupes consecutive same intent", () => {
  const t = new NarrationThrottle(4000);
  assert.equal(t.consider("work_code", 0), "writing and running some code", "first line speaks");
  assert.equal(t.consider("work_code", 1000), null, "same phrase within gap is suppressed");
  assert.equal(t.consider("browser_open", 1000), null, "different phrase still within the rate gap is suppressed");
  assert.equal(t.consider("browser_open", 4000), "browsing the web", "after the gap a new phrase speaks");
  assert.equal(t.consider("browser_nav", 8000), null, "same phrase (browsing) consecutive is de-duped even after the gap");
  assert.equal(t.consider("work_code", 12000), "writing and running some code", "a changed phrase after the gap speaks again");
});

test("NarrationThrottle.reset clears state for a new turn", () => {
  const t = new NarrationThrottle(4000);
  t.consider("work_code", 0);
  t.reset();
  assert.equal(t.consider("work_code", 100), "writing and running some code", "after reset the same phrase can speak immediately");
});

test("StillWorkingTimer emits a check-in only after the idle window", () => {
  const t = new StillWorkingTimer(20000, 0);
  assert.equal(t.tick(10000), null, "silent < idleMs -> no check-in");
  assert.equal(t.tick(20000), "Still working on it.", "silent >= idleMs -> check-in");
  assert.equal(t.tick(30000), null, "resets after emitting; not yet idle again");
  assert.equal(t.tick(40000), "Still working on it.", "another full idle window -> another check-in");
});

test("StillWorkingTimer.markSpoken defers the next check-in", () => {
  const t = new StillWorkingTimer(20000, 0);
  t.markSpoken(15000); // narration spoke at 15s
  assert.equal(t.tick(20000), null, "only 5s since last spoken -> no check-in");
  assert.equal(t.tick(35000), "Still working on it.", "20s since last spoken -> check-in");
});

test("WORK_ACK is a short spoken acknowledgement", () => {
  assert.ok(WORK_ACK.length > 0 && WORK_ACK.split(" ").length <= 8);
});
