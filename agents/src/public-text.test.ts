import assert from "node:assert/strict";
import test from "node:test";
import { assertPublicText, publicTextViolations } from "./public-text";

test("generic engine text is allowed", () => {
  assert.deepEqual(publicTextViolations("One fingerprint is one issue."), []);
  assert.equal(assertPublicText("Worker never merges."), "Worker never merges.");
});

test("install hosts and wrapper names are refused", () => {
  const host = ["my", "ax", "cloudflare", "dev"].join(".");
  assert.ok(publicTextViolations(`see https://${host}/`).includes(host));
  assert.ok(publicTextViolations("Needs GITHUB_TOKEN on the employee Worker.").includes("employee worker"));
  assert.throws(() => assertPublicText("run deploy-employee.sh"), /private install/);
});
