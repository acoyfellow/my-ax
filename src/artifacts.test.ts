import assert from "node:assert/strict";
import test from "node:test";
import type { AccessIdentity } from "./auth";
import type { Env } from "./types";
import { readOwnedSvelteArtifact } from "./artifacts";

const identity: AccessIdentity = { email: "owner@example.com", sub: "owner" };
const ID = "123e4567-e89b-12d3-a456-426614174000";

const validManifest = {
  schema: "my-ax.svelte-artifact.v1",
  id: ID,
  kind: "svelte-widget",
  title: "Widget",
  source: "<h1>hi</h1>",
  sourceHash: "hash-1",
  clientJs: "export default {}",
  css: "",
  svelteVersion: "5.0.0",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function envFor(jsonBody: unknown, opts: { throwJson?: boolean } = {}): Env {
  const row = {
    id: ID, owner_email: identity.email, session_id: "s", kind: "svelte-widget",
    title: "Widget", storage_key: "artifacts/owner@example.com/s/w.json", source_hash: "hash-1",
    created_at: "2026-01-01T00:00:00.000Z",
  };
  return {
    USER_UPLOADS: {
      get: async () => ({ json: async () => { if (opts.throwJson) throw new Error("bad json"); return jsonBody; } }),
    },
    DB: {
      prepare: () => ({ bind: () => ({ first: async () => row }) }),
    },
  } as unknown as Env;
}

test("readOwnedSvelteArtifact returns a fully valid manifest", async () => {
  const out = await readOwnedSvelteArtifact(envFor(validManifest), identity, ID);
  assert.equal(out?.title, "Widget");
});

test("readOwnedSvelteArtifact fails closed on a non-string field", async () => {
  const out = await readOwnedSvelteArtifact(envFor({ ...validManifest, title: 42 }), identity, ID);
  assert.equal(out, null);
});

test("readOwnedSvelteArtifact fails closed on a missing field", async () => {
  const { clientJs, ...missing } = validManifest;
  void clientJs;
  const out = await readOwnedSvelteArtifact(envFor(missing), identity, ID);
  assert.equal(out, null);
});

test("readOwnedSvelteArtifact fails closed on a sourceHash mismatch with the row", async () => {
  const out = await readOwnedSvelteArtifact(envFor({ ...validManifest, sourceHash: "tampered" }), identity, ID);
  assert.equal(out, null);
});

test("readOwnedSvelteArtifact fails closed on unparseable JSON", async () => {
  const out = await readOwnedSvelteArtifact(envFor(null, { throwJson: true }), identity, ID);
  assert.equal(out, null);
});
