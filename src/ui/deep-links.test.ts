import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { myAxDeepLinkIntent, parseMyAxDeepLink } from "./deep-links";

const current = "https://my.ax.example/?session=current";

test("parses an owner-session deep link without falling back to the current session", () => {
  assert.deepEqual(parseMyAxDeepLink("/?session=target-123", current), {
    href: "/?session=target-123",
    sessionId: "target-123",
    action: null,
  });
});

test("preserves attention actions and ordinary same-origin paths", () => {
  assert.equal(parseMyAxDeepLink("/?action=attention", current)?.action, "attention");
  assert.equal(parseMyAxDeepLink("/decisions/abc", current)?.href, "/decisions/abc");
});

test("an informational root push preserves the warm client's active conversation", () => {
  const target = parseMyAxDeepLink("/", current);
  assert.ok(target);
  assert.deepEqual(myAxDeepLinkIntent(target), { kind: "preserve" });
});

test("deep-link intents distinguish session, attention, receipt, and ordinary navigation", () => {
  const session = parseMyAxDeepLink("/?session=target", current);
  const attention = parseMyAxDeepLink("/?action=attention", current);
  const receipt = parseMyAxDeepLink("/runs/run-123", current);
  const ordinary = parseMyAxDeepLink("/decisions/abc", current);
  assert.ok(session && attention && receipt && ordinary);
  assert.deepEqual(myAxDeepLinkIntent(session), { kind: "session", sessionId: "target" });
  assert.deepEqual(myAxDeepLinkIntent(attention), { kind: "attention" });
  assert.deepEqual(myAxDeepLinkIntent(receipt), { kind: "run-receipt", runId: "run-123" });
  assert.deepEqual(myAxDeepLinkIntent(ordinary), { kind: "navigate", href: "/decisions/abc" });
});

test("rejects external notification destinations", () => {
  assert.equal(parseMyAxDeepLink("https://evil.example/", current), null);
});

test("warm PWA and service-worker launches deliver the target instead of reloading cached state", () => {
  const layout = readFileSync(new URL("../../src/views/Layout.tsx", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
  assert.match(layout, /location\.href=url\.pathname\+url\.search\+url\.hash;return;/);
  assert.match(worker, /postMessage\(\{ type: "my-ax:navigate", href: absolute \}\)/);
  assert.match(worker, /existing\.navigate\(absolute\)/);
  assert.doesNotMatch(worker, /existing\.navigate\(href\)/);
});

test("rejects a scheme-relative (//host) target that would re-navigate cross-origin", () => {
  assert.equal(parseMyAxDeepLink("https://my.ax.example//evil.example/phish", current), null);
  assert.equal(parseMyAxDeepLink("//evil.example/phish", current), null);
  // A normal same-origin path still parses.
  assert.equal(parseMyAxDeepLink("/?session=abc", current)?.sessionId, "abc");
});
