import assert from "node:assert/strict";
import test from "node:test";
import type { AccessIdentity } from "./auth";
import type { Env } from "./types";
import { assertOwnedUploadKey, getRasterArtifact, storeImageUpload, storeInlineMediaArtifact } from "./uploads";

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

test("storeInlineMediaArtifact stores screen recordings as owner-scoped video artifacts", async () => {
  const stored: Array<{ key: string; bytes: Uint8Array; contentType?: string; kind?: string }> = [];
  const bucket = {
    put: async (key: string, bytes: Uint8Array, options: { httpMetadata?: { contentType?: string }; customMetadata?: { kind?: string } }) => {
      stored.push({ key, bytes, contentType: options.httpMetadata?.contentType, kind: options.customMetadata?.kind });
    },
  };
  const env = { USER_UPLOADS: bucket } as unknown as Env;

  const artifact = await storeInlineMediaArtifact(env, identity, `data:video/quicktime;base64,${btoa("mov")}`);

  assert.equal(artifact?.kind, "video-artifact");
  assert.equal(artifact?.mime, "video/quicktime");
  assert.equal(stored[0]?.contentType, "video/quicktime");
  assert.equal(stored[0]?.kind, "tool-video");
  assert.match(stored[0]?.key ?? "", /^artifacts\/owner@example\.com\/[0-9a-f-]+\.mov$/);
});

test("assertOwnedUploadKey rejects an arbitrary same-owner key that isn't a canonical upload", () => {
  assert.throws(() => assertOwnedUploadKey(identity, "uploads/owner@example.com/private/cache.bin"), /upload not found/);
  assert.throws(() => assertOwnedUploadKey(identity, "uploads/owner@example.com/"), /upload not found/);
  assert.throws(() => assertOwnedUploadKey(identity, "uploads/owner@example.com/sess/not-a-uuid.png"), /upload not found/);
  // A legitimately generated key still passes.
  const good = `uploads/owner@example.com/draft/123e4567-e89b-12d3-a456-426614174000.png`;
  assert.doesNotThrow(() => assertOwnedUploadKey(identity, good));
});
