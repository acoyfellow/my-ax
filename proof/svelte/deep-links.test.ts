import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseMyAxDeepLink } from "./deep-links";

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

test("rejects external notification destinations", () => {
  assert.equal(parseMyAxDeepLink("https://evil.example/", current), null);
});

test("warm PWA and service-worker launches deliver the target instead of reloading cached state", () => {
  const layout = readFileSync(new URL("../../src/views/Layout.tsx", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
  assert.match(layout, /location\.href=url\.pathname\+url\.search\+url\.hash;return;/);
  assert.match(worker, /postMessage\(\{ type: "my-ax:navigate", href: absolute \}\)/);
  assert.doesNotMatch(worker, /existing\.navigate\(href\)/);
});
