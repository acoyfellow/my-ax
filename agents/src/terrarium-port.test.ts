import assert from "node:assert/strict";
import test from "node:test";
import { liveTerrariumPort } from "./ports";
import { verifyTerrariumReceipt } from "./policy";

test("the live Terrarium port reads the verified status response shape", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/runs") && init?.method === "POST") {
      return Response.json({
        runId: "ter_live_1",
        contract: { runId: "ter_live_1", taskFingerprint: "fingerprint-1", nonce: "nonce-1" },
      }, { status: 202 });
    }
    if (url.endsWith("/api/runs/ter_live_1/status")) {
      return Response.json({
        ok: true,
        status: {
          runId: "ter_live_1",
          status: "done",
          taskFingerprint: "fingerprint-1",
          terminal: { ok: true, taskContractStatus: "verified" },
        },
      });
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
  try {
    const port = liveTerrariumPort({ TERRARIUM_URL: "https://terrarium.example", TERRARIUM_CONTROL_TOKEN: "token" });
    const contract = await port.spawn("task", "test -f package.json");
    const receipt = await port.wait(contract.runId);
    assert.equal(verifyTerrariumReceipt(contract, receipt), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
