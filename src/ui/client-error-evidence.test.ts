import assert from "node:assert/strict";
import test from "node:test";
import { buildClientErrorReport } from "./client-error-report";
import { errorFingerprint, formatAutoIssueBody, parseErrorReportInput } from "../error-report";

test("a client error report carries the session so it can be root caused", () => {
  const report = buildClientErrorReport("Agent completed without a visible response. Please retry.", undefined, "sess-abc");
  assert.equal(report.sessionId, "sess-abc", "the session id was computed but never sent");
});

test("a client error report omits an absent session and stack", () => {
  const report = buildClientErrorReport("boom", undefined, "");
  assert.deepEqual(report, { message: "boom" });
});

test("a stack gives the filed issue a site instead of an unknown one", async () => {
  const withoutStack = parseErrorReportInput({ origin: "client", ...buildClientErrorReport("Agent completed without a visible response. Please retry.", undefined, "s") });
  const withStack = parseErrorReportInput({
    origin: "client",
    ...buildClientErrorReport(
      "Agent completed without a visible response. Please retry.",
      "Error: no-visible-response\n    at done (Chat.svelte:1602:9)",
      "s",
    ),
  });
  if (!withoutStack || !withStack) throw new Error("expected parsed reports");

  const fpWithout = await errorFingerprint(withoutStack);
  const fpWith = await errorFingerprint(withStack);

  assert.doesNotMatch(formatAutoIssueBody(withoutStack, fpWithout), /^site:/m, "no stack means no site to act on");
  assert.match(formatAutoIssueBody(withStack, fpWith), /^site: Chat\.svelte$/m);

  assert.notEqual(fpWithout, fpWith, "a report with a site must not collide with the siteless one");
});
