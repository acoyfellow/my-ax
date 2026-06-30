import assert from "node:assert/strict";
import test from "node:test";
import { AccessError, normalizeAccessIssuer, resolveAccessIssuerForTest, verifyAccessRequest } from "./auth";

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


test("dev bypass works for local loopback browser navigation", async () => {
  const identity = await verifyAccessRequest(new Request("http://localhost/api/health"), {
    ENVIRONMENT: "dev",
    CF_ACCESS_ISS: "",
    CF_ACCESS_AUD: "",
    DEV_USER_EMAIL: "Dev@Localhost",
  });
  assert.equal(identity.email, "dev@localhost");
  assert.equal(identity.sub, "dev-Dev@Localhost");
});

test("dev bypass also accepts the miniflare/proxy runtime signal", async () => {
  const identity = await verifyAccessRequest(new Request("http://localhost/api/health", { headers: { "MF-Original-URL": "http://localhost/api/health" } }), {
    ENVIRONMENT: "dev",
    CF_ACCESS_ISS: "",
    CF_ACCESS_AUD: "",
    DEV_USER_EMAIL: "Dev@Localhost",
  });
  assert.equal(identity.email, "dev@localhost");
  assert.equal(identity.sub, "dev-Dev@Localhost");
});

test("blank Access config with dev email fails closed outside local runtime", async () => {
  await assert.rejects(
    verifyAccessRequest(new Request("https://my-ax.coey.dev/api/health"), {
      ENVIRONMENT: "dev",
      CF_ACCESS_ISS: "",
      CF_ACCESS_AUD: "",
      DEV_USER_EMAIL: "dev@localhost",
    }),
    (err) => err instanceof AccessError && err.tag === "NoAccessJwt",
  );
});

test("prod-like blank Access config does not bypass dev email", async () => {
  await assert.rejects(
    verifyAccessRequest(new Request("https://my-ax.coey.dev/api/health"), {
      ENVIRONMENT: "production",
      CF_ACCESS_ISS: "",
      CF_ACCESS_AUD: "",
      DEV_USER_EMAIL: "dev@localhost",
      MINIFLARE: "1",
    }),
    (err) => err instanceof AccessError && err.tag === "NoAccessJwt",
  );
});
