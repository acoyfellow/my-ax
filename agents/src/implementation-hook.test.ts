import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import hook from "./hook";

test("a sweep requires a signed body before the hook forwards it", async () => {
  let forwarded = 0;
  const env = { GITHUB_WEBHOOK_SECRET: "test-secret", HOOK_FORWARD_SECRET: "forward-secret", AGENTS: { async fetch(request: Request) {
    forwarded++;
    assert.equal(request.headers.get("x-ax-hook-forward"), "forward-secret");
    assert.equal(new URL(request.url).pathname, "/factory/sweep");
    return Response.json({ ok: true });
  } } };
  const body = JSON.stringify({ issue: 213 });
  const signature = `sha256=${createHmac("sha256", "test-secret").update(body).digest("hex")}`;
  for (const sig of ["", "sha256=wrong"]) {
    const response = await hook.fetch(new Request("https://hooks.example/factory/sweep", { method: "POST", body, headers: { "x-hub-signature-256": sig } }), env as any);
    assert.equal(response.status, 401);
  }
  assert.equal(forwarded, 0);
  const response = await hook.fetch(new Request("https://hooks.example/factory/sweep", { method: "POST", body, headers: { "x-hub-signature-256": signature } }), env as any);
  assert.equal(response.status, 200);
  assert.equal(forwarded, 1);
});

test("the public hook forwards implementation submissions and rejects unknown paths", async () => {
  const forwarded: Request[] = [];
  const env = {
    GITHUB_WEBHOOK_SECRET: "github-secret",
    HOOK_FORWARD_SECRET: "forward-secret",
    AGENTS: {
      async fetch(request: Request) {
        forwarded.push(request);
        return new Response("ok");
      },
    },
  };
  const submission = await hook.fetch(new Request("https://hooks.example/factory/submissions", {
    method: "POST",
    headers: { authorization: "Bearer grant" },
    body: "{\"files\":[]}",
  }), env as any);
  assert.equal(submission.status, 200);
  assert.equal(forwarded.length, 1);
  assert.equal(new URL(forwarded[0]!.url).pathname, "/factory/submissions");
  assert.equal(forwarded[0]!.headers.get("authorization"), "Bearer grant");
  assert.equal(forwarded[0]!.headers.get("x-ax-hook-forward"), "forward-secret");
  const rejected = await hook.fetch(new Request("https://hooks.example/other", { method: "POST" }), env as any);
  assert.equal(rejected.status, 404);
});
