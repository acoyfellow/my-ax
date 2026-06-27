import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAccessIssuer, resolveAccessIssuerForTest } from "./auth";

function unsignedJwt(payload: Record<string, unknown>) {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${enc({ alg: "none" })}.${enc(payload)}.`;
}

test("normalizes Cloudflare Access issuer URLs", () => {
  assert.equal(normalizeAccessIssuer("https://team.cloudflareaccess.com/"), "https://team.cloudflareaccess.com");
  assert.equal(normalizeAccessIssuer("http://team.cloudflareaccess.com"), null);
  assert.equal(normalizeAccessIssuer("not a url"), null);
  assert.equal(normalizeAccessIssuer(""), null);
});

test("falls back to JWT issuer when the configured issuer is malformed", () => {
  const token = unsignedJwt({ iss: "https://support-chat.cloudflareaccess.com", aud: ["aud"] });
  assert.equal(resolveAccessIssuerForTest(token, "not a url"), "https://support-chat.cloudflareaccess.com");
});

test("configured issuer wins when valid", () => {
  const token = unsignedJwt({ iss: "https://evil.example.com", aud: ["aud"] });
  assert.equal(resolveAccessIssuerForTest(token, "https://support-chat.cloudflareaccess.com/"), "https://support-chat.cloudflareaccess.com");
});
