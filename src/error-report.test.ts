import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  errorFingerprint,
  formatAutoIssueBody,
  formatAutoIssueTitle,
  normalizeErrorMessage,
  parseErrorReportInput,
  stackFingerprintSite,
} from "./error-report";

test("long image errors collapse to one message", () => {
  assert.equal(
    normalizeErrorMessage("The image data you provided does not represent a valid image. Please check your input and try again with one of the supported image formats: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']."),
    "The image data you provided does not represent a valid image.",
  );
});

test("Invalid URL variants share one fingerprint", async () => {
  const a = await errorFingerprint({ origin: "server", message: "Invalid URL string.", stack: "Error: Invalid URL string.\n    at buildUrl (agent.ts:1:1)" });
  const b = await errorFingerprint({ origin: "server", message: "invalid url string", stack: "TypeError: Invalid URL string.\n    at other (agent.ts:40:2)" });
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{16}$/);
});

test("client and server fingerprints stay apart", async () => {
  const server = await errorFingerprint({ origin: "server", message: "Invalid URL string." });
  const client = await errorFingerprint({ origin: "client", message: "Invalid URL string." });
  assert.notEqual(server, client);
});

test("a server-surfaced toast is not re-reported by the client", () => {
  const store = readFileSync(new URL("./ui/store.svelte.ts", import.meta.url), "utf8");
  const chat = readFileSync(new URL("./ui/Chat.svelte", import.meta.url), "utf8");
  assert.match(store, /alreadyReported\b/);
  assert.match(store, /if \(options\?\.alreadyReported\) return;/);
  const agentFailures = chat.match(/pushError\(m\.body \|\| "Agent request failed"[^)]*\)/g) ?? [];
  assert.ok(agentFailures.length >= 3, "expected the server-surfaced pushError call sites");
  for (const call of agentFailures) {
    assert.match(call, /alreadyReported: true/, `server-surfaced error must not double-file: ${call}`);
  }
});

test("stack site ignores node internals", () => {
  assert.equal(
    stackFingerprintSite("Error: boom\n    at run (node:internal/foo:1:1)\n    at render (Chat.svelte:1534:9)"),
    "Chat.svelte",
  );
});

test("parseErrorReportInput fails closed", () => {
  assert.equal(parseErrorReportInput(null), null);
  assert.equal(parseErrorReportInput({ origin: "client" }), null);
  assert.equal(parseErrorReportInput({ origin: "bot", message: "x" }), null);
  const parsed = parseErrorReportInput({
    origin: "client",
    message: "Invalid URL string.",
    sessionId: "e4834b21-0135-47a5-a0eb-3ae61e300edf",
    href: "https://example.test/?session=e4834b21",
  });
  assert.equal(parsed?.origin, "client");
  assert.equal(parsed?.sessionId, "e4834b21-0135-47a5-a0eb-3ae61e300edf");
});

test("issue body names the fingerprint and forbids auto draft", () => {
  const input = {
    origin: "server" as const,
    message: "Invalid URL string.",
    sessionId: "e4834b21-0135-47a5-a0eb-3ae61e300edf",
    versionId: "7cc9619b-1930-4c31-b396-5d59565a360f",
  };
  assert.equal(formatAutoIssueTitle(input), "bug: Invalid URL string.");
  const body = formatAutoIssueBody(input, "deadbeefdeadbeef");
  assert.match(body, /fingerprint: `deadbeefdeadbeef`/);
  assert.doesNotMatch(body, /session:/);
  assert.doesNotMatch(body, /version:/);
  assert.doesNotMatch(body, /href:/);
  assert.doesNotMatch(body, /does not opt in a ready PR/);
  assert.match(body, /opts in a ready PR/);
  assert.equal(normalizeErrorMessage("  invalid url string  "), "Invalid URL string.");
});
