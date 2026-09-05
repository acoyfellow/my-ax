import assert from "node:assert/strict";
import test from "node:test";
import { acceptImplementationSubmission } from "./implementation-handler";
import { createImplementationGrant } from "./implementation-submission";

test("a signed submission commits only to its temporary branch", async () => {
  const secret = "stable-github-webhook-secret";
  const nonce = "1234567890abcdef";
  const submissionHead = `factory/submission-184-${nonce}`;
  const token = await createImplementationGrant(secret, {
    issueNumber: 184,
    head: "bot/issue-184",
    submissionHead,
    expiresAt: Date.now() + 60_000,
    nonce,
  });
  const calls: Array<{ url: string; method: string; body: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    const body = String(init?.body || "");
    calls.push({ url, method, body });
    if (url.includes("/compare/main...")) return Response.json({ files: [{ filename: ".factory/issue-184.md" }] });
    if (url.includes("/git/ref/heads/")) return Response.json({ object: { sha: "parent-sha" } });
    if (url.endsWith("/git/commits/parent-sha")) return Response.json({ tree: { sha: "tree-sha" } });
    if (url.endsWith("/git/blobs")) return Response.json({ sha: "blob-sha" });
    if (url.endsWith("/git/trees")) return Response.json({ sha: "new-tree-sha" });
    if (url.endsWith("/git/commits")) return Response.json({ sha: "new-commit-sha" });
    if (url.includes("/git/refs/heads/") && method === "PATCH") return Response.json({});
    throw new Error(`unexpected request: ${method} ${url}`);
  }) as typeof fetch;
  try {
    const response = await acceptImplementationSubmission(new Request("https://agents.internal/factory/submissions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-ax-hook-forward": "forward-secret",
      },
      body: JSON.stringify({ files: [
        { path: "src/ui/message.ts", content: "export const text = 'hello';\n" },
        { path: "src/ui/message.test.ts", content: "export {};\n" },
      ] }),
    }), {
      GITHUB_TOKEN: "github-token",
      GITHUB_REPO: "acoyfellow/my-ax",
      GITHUB_WEBHOOK_SECRET: secret,
      HOOK_FORWARD_SECRET: "forward-secret",
    } as any);
    assert.equal(response.status, 200);
    const result = await response.json() as { accepted: boolean; head: string; commit: string };
    assert.equal(result.accepted, true);
    assert.equal(result.head, submissionHead);
    assert.equal(result.commit, "new-commit-sha");
    const refUpdate = calls.find((call) => call.method === "PATCH");
    assert.ok(refUpdate?.url.includes(encodeURIComponent(submissionHead)));
    assert.doesNotMatch(refUpdate?.url || "", /bot%2Fissue-184/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
