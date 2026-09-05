import assert from "node:assert/strict";
import test from "node:test";
import hook from "./hook";

test("the public hook forwards only implementation submissions and GitHub webhooks", async () => {
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
