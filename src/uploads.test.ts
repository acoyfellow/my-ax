import assert from "node:assert/strict";
import test from "node:test";
import type { AccessIdentity } from "./auth";
import type { Env } from "./types";
import { assertOwnedUploadKey, getRasterArtifact, storeImageUpload } from "./uploads";

const identity: AccessIdentity = { email: "owner@example.com", sub: "owner" };

test("storeImageUpload keeps an untrusted session ID in one owned key segment", async () => {
  let storedKey = "";
  const bucket = {
    put: async (key: string) => { storedKey = key; },
  };
  const env = { USER_UPLOADS: bucket } as unknown as Env;
  const file = new File([new Uint8Array([1])], "pixel.png", { type: "image/png" });

  const attachment = await storeImageUpload(env, identity, "../another/session", file);

  assert.equal(attachment.key, storedKey);
  assert.doesNotThrow(() => assertOwnedUploadKey(identity, attachment.key));
  assert.match(attachment.key, /^uploads\/owner@example\.com\/%2E%2E%2Fanother%2Fsession\//);
});

test("getRasterArtifact rejects malformed IDs before reading R2", async () => {
  let reads = 0;
  const bucket = {
    get: async () => { reads++; return null; },
  };
  const env = { USER_UPLOADS: bucket } as unknown as Env;

  await assert.rejects(
    getRasterArtifact(env, identity, "------------------------------------"),
    /artifact not found/,
  );
  assert.equal(reads, 0);
});

test("getRasterArtifact reads an owner-scoped UUID artifact", async () => {
  const keys: string[] = [];
  const bucket = {
    get: async (key: string) => { keys.push(key); return key.endsWith(".webp") ? { key } : null; },
  };
  const env = { USER_UPLOADS: bucket } as unknown as Env;

  const object = await getRasterArtifact(env, identity, "123e4567-e89b-12d3-a456-426614174000");

  assert.deepEqual(object, { key: "artifacts/owner@example.com/123e4567-e89b-12d3-a456-426614174000.webp" });
  assert.equal(keys.length, 4);
});
