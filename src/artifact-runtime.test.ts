import assert from "node:assert/strict";
import test from "node:test";
import { ARTIFACT_RUNTIME_JS } from "./artifact-runtime";
import { OUTBOUND_ALLOWLIST } from "./ui/artifact-outbound";

test("the runtime installs window.myax with an invoke door", () => {
  assert.match(ARTIFACT_RUNTIME_JS, /window\.myax\s*=/);
  assert.match(ARTIFACT_RUNTIME_JS, /invoke:\s*invoke/);
});

test("the runtime speaks the outbound frame the host listens for", () => {
  assert.match(ARTIFACT_RUNTIME_JS, /"my-ax:host-invoke"/);
  assert.match(ARTIFACT_RUNTIME_JS, /"my-ax:host-invoke-result"/);
});

test("every convenience helper maps to an allowlisted verb", () => {
  const allowed = new Set<string>(OUTBOUND_ALLOWLIST);
  const calls = [...ARTIFACT_RUNTIME_JS.matchAll(/invoke\("([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.ok(calls.length >= 6, "expected several convenience helpers");
  const outside = [...new Set(calls)].filter((name) => !allowed.has(name));
  assert.deepEqual(outside, [], `helpers call verbs outside the allowlist: ${outside.join(", ")}`);
});

test("the runtime bounds its own wait so a dead host cannot hang the artifact", () => {
  assert.match(ARTIFACT_RUNTIME_JS, /host_invoke_timeout/);
});

test("the runtime never reads cookies or calls the api directly", () => {
  assert.doesNotMatch(ARTIFACT_RUNTIME_JS, /document\.cookie/);
  assert.doesNotMatch(ARTIFACT_RUNTIME_JS, /fetch\(/);
  assert.doesNotMatch(ARTIFACT_RUNTIME_JS, /XMLHttpRequest/);
});

test("the runtime is syntactically valid javascript", () => {
  assert.doesNotThrow(() => new Function(ARTIFACT_RUNTIME_JS.replace(/window/g, "globalThis")));
});
