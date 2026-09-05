import assert from "node:assert/strict";
import test from "node:test";
import { createImplementationGrant, validateImplementationFiles, verifyImplementationGrant } from "./implementation-submission";

const secret = "factory-secret-for-tests";

test("an implementation grant is limited to one issue branch and expiry", async () => {
  const token = await createImplementationGrant(secret, {
    issueNumber: 184,
    head: "bot/issue-184",
    submissionHead: "factory/submission-184-1234567890abcdef",
    expiresAt: 2_000,
    nonce: "1234567890abcdef",
  });
  const grant = await verifyImplementationGrant(secret, token, 1_000);
  assert.equal(grant.issueNumber, 184);
  assert.equal(grant.head, "bot/issue-184");
  assert.equal(grant.submissionHead, "factory/submission-184-1234567890abcdef");
  await assert.rejects(() => verifyImplementationGrant(secret, token, 2_001), /expired/);
  await assert.rejects(() => verifyImplementationGrant("wrong-secret", token, 1_000), /invalid implementation grant/);
});

test("implementation files are bounded to product and migration paths", () => {
  assert.deepEqual(validateImplementationFiles([
    { path: "src/ui/message.ts", content: "export const message = 'ok';\n" },
    { path: "src/ui/message.test.ts", content: "export {};\n" },
    { path: "migrations/0030_session.sql", content: "SELECT 1;\n" },
  ]).map((file) => file.path), ["src/ui/message.ts", "src/ui/message.test.ts", "migrations/0030_session.sql"]);
  assert.throws(() => validateImplementationFiles([{ path: ".github/workflows/deploy.yml", content: "x" }]), /invalid implementation path/);
  assert.throws(() => validateImplementationFiles([{ path: "agents/src/worker.ts", content: "x" }]), /invalid implementation path/);
  assert.throws(() => validateImplementationFiles([{ path: "migrations/0030.sql", content: "x" }]), /product source file/);
});
