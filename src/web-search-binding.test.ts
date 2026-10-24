import { test } from "node:test";
import assert from "node:assert/strict";
import { searchFetchFor } from "./web-search";

test("the AI binding websearch is preferred and uses the configured gateway", async () => {
  const calls: unknown[] = [];
  const fetch = searchFetchFor({
    AI: { websearch: async (request: unknown) => { calls.push(request); return Response.json({ items: [{ url: "https://example.com", title: "t" }] }); } },
    WEBSEARCH: { search: async () => { throw new Error("account_disabled"); } },
    CLOUDFLARE_AI_GATEWAY_ID: "my-gw",
  });
  const body = await fetch!("q");
  assert.deepEqual(body, { items: [{ url: "https://example.com", title: "t" }] });
  assert.deepEqual(calls, [{ gatewayId: "my-gw", query: "q", limit: 10 }]);
});

test("an empty gateway id falls back to the account default gateway", async () => {
  const calls: Array<{ gatewayId: string }> = [];
  const fetch = searchFetchFor({ AI: { websearch: async (request: { gatewayId: string }) => { calls.push(request); return Response.json({ items: [] }); } }, CLOUDFLARE_AI_GATEWAY_ID: "" });
  await fetch!("q");
  assert.equal(calls[0]?.gatewayId, "default");
});

test("a gateway error surfaces its code", async () => {
  const fetch = searchFetchFor({ AI: { websearch: async () => Response.json({ ok: false, error: { code: "web_search_byok_not_configured" } }, { status: 400 }) } });
  await assert.rejects(fetch!("q"), /web_search_byok_not_configured/);
});
