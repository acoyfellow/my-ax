import assert from "node:assert/strict";
import test from "node:test";
import { encryptToken, decryptToken, looksEncrypted } from "./grant-crypto";

// A valid 32-byte base64url master key.
const MASTER_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString("base64url");
const SCOPE = "user:owner@example.com";

test("encrypt -> decrypt round-trips a token", async () => {
  const blob = await encryptToken(MASTER_KEY, SCOPE, "secret-access-token");
  assert.ok(looksEncrypted(blob), "ciphertext must look encrypted");
  assert.equal(await decryptToken(MASTER_KEY, SCOPE, blob), "secret-access-token");
});

test("looksEncrypted only matches the v1.<b64url>.<b64url>.<b64url> shape", () => {
  assert.equal(looksEncrypted("v1.aaa.bbb.ccc"), true);
  assert.equal(looksEncrypted("plaintext-legacy-token"), false);
  assert.equal(looksEncrypted("ya29.legacy.google.token"), false); // 4 parts but v-prefix mismatch
  assert.equal(looksEncrypted("v1.aaa.bbb"), false); // only 3 parts
});

// This is the exact prod failure mode behind CONNECTOR_STATUS_UNAVAILABLE:
// a stored value that PASSES looksEncrypted() but is not a real v1 blob makes
// decryptToken throw (malformed parts / bad base64 / wrong key). The fix lives
// in oauth-store.decryptStoredSet, which now catches this and fails soft; this
// test pins the underlying throw so we never assume decrypt is total.
test("decryptToken throws on a malformed blob that still looks encrypted", async () => {
  await assert.rejects(() => decryptToken(MASTER_KEY, SCOPE, "v1.notvalid.stillnot.base64tag"), /./);
});

test("decryptToken throws on a wrong-length blob", async () => {
  await assert.rejects(() => decryptToken(MASTER_KEY, SCOPE, "v1.aaa.bbb"), /malformed blob/);
});

test("decryptToken rejects an unsupported version", async () => {
  await assert.rejects(() => decryptToken(MASTER_KEY, SCOPE, "v9.aaa.bbb.ccc"), /unsupported encryption version/);
});
