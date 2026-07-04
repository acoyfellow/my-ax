import test from "node:test";
import assert from "node:assert/strict";
import { createCapabilityBundle, parseResourceUrl, runCapabilityReviewDemo } from "./capability-review";

test("parses pasted internal URLs into narrow read capabilities", () => {
  assert.equal(parseResourceUrl("https://jira.cfdata.org/browse/DEVTOOLS-123").kind, "jira.issue.read");
  assert.equal(parseResourceUrl("https://wiki.cfdata.org/spaces/TEAM/pages/123456/Foo+Spec").id, "123456");
  assert.equal(parseResourceUrl("https://gitlab.cfdata.org/group/project/-/merge_requests/42").id, "group/project!42");
  assert.throws(() => parseResourceUrl("https://dash.cloudflare.com/"), /unsupported host|missing account/);
});

test("bundle grants only pasted resources with no search adjacent or write", () => {
  const bundle = createCapabilityBundle({ principal: "jordan@example.com", urls: ["https://jira.cfdata.org/browse/DEVTOOLS-123"] });
  assert.equal(bundle.capabilities.length, 1);
  assert.equal(bundle.capabilities[0].kind, "jira.issue.read");
  assert.deepEqual(bundle.capabilities[0].constraints, { allowSearch: false, allowAdjacent: false, allowWrite: false });
});

test("demo proof shows handle-only child surface, denials, and ask receipt", () => {
  const bundle = createCapabilityBundle({ principal: "jordan@example.com", urls: ["https://jira.cfdata.org/browse/DEVTOOLS-123"] });
  const proof = runCapabilityReviewDemo(bundle);
  assert.equal(proof.decision, "pass");
  assert.deepEqual(proof.childSurface.tools, ["capability_list", "capability_read", "capability_request_more"]);
  assert.ok(proof.denied.some((entry) => entry.result === "tool_not_available" && entry.operation === "cfi"));
  assert.equal(proof.asks[0].status, "ask");
  assert.equal(proof.rawInternalContentPersisted, false);
});
