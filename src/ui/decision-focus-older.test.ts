import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { focusDecision } from "./decision-focus";

test("focusDecision pages older history and expands collapsed details to locate an old decision", async () => {
  let loadedPages = 0;
  let scrolled = false;
  let announced = "";
  const parentDetails = { tagName: "DETAILS", open: false, parentElement: null };
  const fakeEl = {
    parentElement: parentDetails,
    scrollIntoView: () => { scrolled = true; },
    classList: { remove: () => {}, add: () => {} },
    offsetWidth: 100,
  } as unknown as HTMLElement;

  const ok = await focusDecision("dec-old", {
    find: () => (loadedPages >= 2 ? fakeEl : null),
    wait: async () => {},
    announce: (id) => { announced = id; },
    loadOlder: async () => { loadedPages += 1; return loadedPages <= 2; },
  }, 10, 1);

  assert.equal(ok, true);
  assert.equal(loadedPages, 2);
  assert.equal(parentDetails.open, true);
  assert.equal(scrolled, true);
  assert.equal(announced, "dec-old");
});

test("Seismograph uses unified light/dark theme tokens instead of hardcoded hex colors", () => {
  const seismo = readFileSync(new URL("./Seismograph.svelte", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/app.css", import.meta.url), "utf8");
  assert.doesNotMatch(seismo, /#38bdf8|#f59e0b|#a78bfa/i);
  for (const token of ["--seismo-empty", "--seismo-llm", "--seismo-box", "--seismo-mac", "--seismo-web", "--seismo-alert"]) {
    assert.ok(seismo.includes(`var(${token}`), `Seismograph should reference ${token}`);
    assert.ok((css.match(new RegExp(token, "g")) ?? []).length >= 3, `${token} should be defined for dark, light, and system-light`);
  }
});
