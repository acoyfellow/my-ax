import assert from "node:assert/strict";
import test from "node:test";
import { OAuthClientDO, makeOAuthClientStore } from "./oauth-store";
import type { ConnectorHealth } from "./connector-health";

function memoryStorage() {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key: string) { return data.get(key); },
    async put(key: string, value: unknown) { data.set(key, structuredClone(value)); },
    async delete(key: string) { return data.delete(key); },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      return new Map([...data].filter(([key]) => key.startsWith(prefix)));
    },
  };
}

function storeWithOneUser() {
  const storage = memoryStorage();
  const durable = Object.create(OAuthClientDO.prototype) as OAuthClientDO;
  Object.assign(durable, { ctx: { storage, id: { name: "user:owner@example.com", toString: () => "id" } }, env: {} });
  const binding = {
    idFromName: (name: string) => name,
    get: () => ({ fetch: (url: string, init?: RequestInit) => durable.fetch(new Request(url, init)) }),
  } as unknown as Parameters<typeof makeOAuthClientStore>[0];
  return { storage, store: makeOAuthClientStore(binding, "https://app.example") };
}

test("a failed connection is stored per connector and read back", async () => {
  const { store } = storeWithOneUser();
  const failed: ConnectorHealth = { outcome: "failed", error: "redirect_uri is not allowed by the account configuration", checkedAt: "2026-09-27T12:00:00.000Z" };
  await store.recordConnectorHealth("owner@example.com", "ax-mcp", failed);
  assert.deepEqual(await store.listConnectorHealth("owner@example.com"), { "ax-mcp": failed });
});

test("a later success replaces the failure", async () => {
  const { store } = storeWithOneUser();
  await store.recordConnectorHealth("owner@example.com", "ax-mcp", { outcome: "failed", error: "boom", checkedAt: "2026-09-27T12:00:00.000Z" });
  await store.recordConnectorHealth("owner@example.com", "ax-mcp", { outcome: "ready", toolCount: 9, checkedAt: "2026-09-27T12:05:00.000Z" });
  const health = await store.listConnectorHealth("owner@example.com");
  assert.equal(health["ax-mcp"]?.outcome, "ready");
});

test("disconnect clears the stored health", async () => {
  const { store, storage } = storeWithOneUser();
  await store.recordConnectorHealth("owner@example.com", "ax-mcp", { outcome: "ready", toolCount: 9, checkedAt: "2026-09-27T12:00:00.000Z" });
  await store.disconnect("owner@example.com", "ax-mcp");
  assert.equal(storage.data.has("health:ax-mcp"), false);
  assert.deepEqual(await store.listConnectorHealth("owner@example.com"), {});
});

test("malformed health records are rejected by the store", async () => {
  const { storage } = storeWithOneUser();
  const durable = Object.create(OAuthClientDO.prototype) as OAuthClientDO;
  Object.assign(durable, { ctx: { storage, id: { name: "user:owner@example.com" } }, env: {} });
  const response = await durable.fetch(new Request("http://internal/health/record", {
    method: "POST",
    body: JSON.stringify({ connectorId: "ax-mcp", health: { outcome: "connected" } }),
  }));
  assert.equal(response.status, 400);
  assert.equal(storage.data.size, 0);
});
