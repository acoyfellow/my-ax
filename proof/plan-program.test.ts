import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { proofHttpLayer, runSmokeProof } from "./plan-program";

const config = {
  baseUrl: "https://ax.example.com",
  clientId: "client-id",
  clientSecret: "client-secret",
};

test("smoke proof runs four bounded gates without exposing credentials", async () => {
  const requests: Array<{ url: string; authenticated: boolean }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const authenticated = headers.get("CF-Access-Client-Secret") === config.clientSecret;
    requests.push({ url, authenticated });
    if (url.endsWith("/api/health") && authenticated) {
      return Response.json({
        ok: true,
        name: "my-ax",
        version: "sha",
        region: "test",
        bindings: Object.fromEntries(["USER_AGENT", "OAUTH_CLIENT", "SANDBOX", "DB", "AUDIT_KV", "BACKUP_BUCKET", "USER_UPLOADS", "AI", "BROWSER", "LOADER"].map((name) => [name, true])),
        requiredSecretsMissing: [],
      });
    }
    return new Response(null, { status: 302, headers: { location: "https://access.cloudflare.com/login" } });
  };

  const program = runSmokeProof(config).pipe(Effect.provide(proofHttpLayer(fetchImpl)));
  assert.equal(requests.length, 0);
  const receipt = await Effect.runPromise(program);
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.results.length, 4);
  assert.equal(requests.length, 4);
  assert.doesNotMatch(JSON.stringify(receipt), /client-secret|client-id/);
});

test("smoke proof records transport failures instead of aborting later gates", async () => {
  const receipt = await Effect.runPromise(runSmokeProof(config).pipe(Effect.provide(proofHttpLayer(async () => {
    throw new Error("network unavailable");
  }))));

  assert.equal(receipt.status, "fail");
  assert.equal(receipt.results.length, 4);
  assert.ok(receipt.results.every((result) => result.status === "fail"));
  assert.ok(receipt.results.every((result) => result.failures[0]?.includes("ProofHttpError")));
});
