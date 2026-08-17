import assert from "node:assert/strict";
import test from "node:test";
import { verifyGithubSignature } from "./github-hmac";

test("unsigned and wrong HMAC are rejected", async () => {
  assert.equal(await verifyGithubSignature("s3cret", "{\"ok\":true}", ""), false);
  assert.equal(await verifyGithubSignature("s3cret", "{\"ok\":true}", "sha256=deadbeef"), false);
});

test("matching HMAC is accepted", async () => {
  const secret = "s3cret";
  const raw = "{\"action\":\"opened\"}";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const digest = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifyGithubSignature(secret, raw, `sha256=${digest}`), true);
});
