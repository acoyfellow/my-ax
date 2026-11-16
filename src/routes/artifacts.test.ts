import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { VERSION } from "svelte/compiler";
import type { AppEnv } from "../app-env";
import type { Env } from "../types";
import { registerArtifactRoutes, ARTIFACT_SVELTE_RUNTIME } from "./artifacts";

const ID = "123e4567-e89b-12d3-a456-426614174000";
const OWNER = "owner@example.com";

function manifest(sourceHash: string) {
  return {
    schema: "my-ax.svelte-artifact.v1",
    id: ID,
    kind: "svelte-widget",
    title: "Widget",
    source: "<div>{x}</div>",
    sourceHash,
    clientJs: `export default function W() { return "${sourceHash}"; }`,
    css: "",
    svelteVersion: VERSION,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function appWith(state: { sourceHash: string }) {
  const env = {
    USER_UPLOADS: { get: async () => ({ json: async () => manifest(state.sourceHash) }) },
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            id: ID, owner_email: OWNER, session_id: "s", kind: "svelte-widget", title: "Widget",
            storage_key: "artifacts/k.json", source_hash: state.sourceHash, created_at: "2026-01-01T00:00:00.000Z",
          }),
        }),
      }),
    },
  } as unknown as Env;
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("identity", { email: OWNER, sub: "owner" }); await next(); });
  registerArtifactRoutes(app);
  return { request: (path: string, init?: RequestInit) => app.request(path, init, env) };
}

test("the preview runtime is the same svelte version the widgets are compiled with", async () => {
  assert.equal(ARTIFACT_SVELTE_RUNTIME, `https://esm.sh/svelte@${VERSION}`);
  const response = await appWith({ sourceHash: "a" }).request(`/api/artifacts/${ID}/preview`);
  const html = await response.text();
  const runtimes = [...html.matchAll(/https:\/\/esm\.sh\/svelte@([0-9][^"/]*)/g)].map((match) => match[1]);
  assert.ok(runtimes.length > 0, "preview names a runtime");
  assert.deepEqual([...new Set(runtimes)], [VERSION]);
});

test("the preview is never cached as immutable, so a source edit reaches a browser that already loaded it", async () => {
  const response = await appWith({ sourceHash: "a" }).request(`/api/artifacts/${ID}/preview`);
  const cacheControl = response.headers.get("Cache-Control") ?? "";
  assert.doesNotMatch(cacheControl, /immutable/);
  assert.match(cacheControl, /no-cache/);
  assert.equal(response.headers.get("ETag"), `"a"`);
});

test("a browser revalidating an unchanged widget gets 304, and an edited widget gets the new version", async () => {
  const state = { sourceHash: "a" };
  const app = appWith(state);
  const unchanged = await app.request(`/api/artifacts/${ID}/preview`, { headers: { "If-None-Match": `"a"` } });
  assert.equal(unchanged.status, 304);
  state.sourceHash = "b";
  const edited = await app.request(`/api/artifacts/${ID}/preview`, { headers: { "If-None-Match": `"a"` } });
  assert.equal(edited.status, 200);
  assert.equal(edited.headers.get("ETag"), `"b"`);
  assert.match(await edited.text(), /W\(\) \{ return \\?%22b%22|return%20%22b%22/);
});
