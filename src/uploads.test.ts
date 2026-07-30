import assert from "node:assert/strict";
import test from "node:test";
import type { AccessIdentity } from "./auth";
import type { Env } from "./types";
import { assertOwnedUploadKey, getRasterArtifact, storeImageUpload, storeInlineMediaArtifact } from "./uploads";

const identity: AccessIdentity = { email: "owner@example.com", sub: "owner" };
const imageSizeLimitBytes = 10 * 1024 * 1024;
const imageSignatures = {
  "image/png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": new Uint8Array([0xff, 0xd8, 0xff]),
  "image/webp": new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
  "image/gif": new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
} as const;

type ImageType = keyof typeof imageSignatures;

type StoredImage = {
  key: string;
  contentType?: string;
  originalName?: string;
};

function createUploadsEnv() {
  const stored: StoredImage[] = [];
  const bucket = {
    put: async (
      key: string,
      _body: ReadableStream,
      options: { httpMetadata?: { contentType?: string }; customMetadata?: { originalName?: string } },
    ) => {
      stored.push({
        key,
        contentType: options.httpMetadata?.contentType,
        originalName: options.customMetadata?.originalName,
      });
    },
  };
  return { env: { USER_UPLOADS: bucket } as unknown as Env, stored };
}

function imageFile(type: ImageType, name: string, bytes = imageSignatures[type]) {
  return new File([bytes], name, { type });
}

test("storeImageUpload keeps an untrusted session ID in one owned key segment", async () => {
  let storedKey = "";
  const bucket = {
    put: async (key: string) => { storedKey = key; },
  };
  const env = { USER_UPLOADS: bucket } as unknown as Env;
  const file = imageFile("image/png", "pixel.png");

  const attachment = await storeImageUpload(env, identity, "../another/session", file);

  assert.equal(attachment.key, storedKey);
  assert.doesNotThrow(() => assertOwnedUploadKey(identity, attachment.key));
  assert.match(attachment.key, /^uploads\/owner@example\.com\/%2E%2E%2Fanother%2Fsession\//);
});

test("storeImageUpload accepts each supported MIME type with its signature", async () => {
  const supportedTypes = [
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
  ] as const;

  for (const [mime, extension] of supportedTypes) {
    const { env, stored } = createUploadsEnv();
    const file = imageFile(mime, `pixel.${extension}`);

    const attachment = await storeImageUpload(env, identity, "boundary", file);

    assert.equal(attachment.mime, mime);
    assert.equal(attachment.bytes, imageSignatures[mime].length);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.contentType, mime);
    assertOwnedUploadKey(identity, attachment.key);
  }
});

test("storeImageUpload accepts a payload exactly at the 10 MB size limit", async () => {
  const { env, stored } = createUploadsEnv();
  const bytes = new Uint8Array(imageSizeLimitBytes);
  bytes.set(imageSignatures["image/png"]);
  const file = imageFile("image/png", "limit.png", bytes);

  const attachment = await storeImageUpload(env, identity, "boundary", file);

  assert.equal(attachment.bytes, imageSizeLimitBytes);
  assert.equal(stored.length, 1);
  assertOwnedUploadKey(identity, attachment.key);
});

test("storeImageUpload rejects a payload one byte over the 10 MB size limit", async () => {
  const { env, stored } = createUploadsEnv();
  const file = imageFile("image/png", "over-limit.png", new Uint8Array(imageSizeLimitBytes + 1));

  await assert.rejects(storeImageUpload(env, identity, "boundary", file), /Image must be between 1 byte and 10 MB/);
  assert.equal(stored.length, 0);
});

test("storeImageUpload rejects an unsupported MIME type", async () => {
  const { env, stored } = createUploadsEnv();
  const file = new File([new Uint8Array([0])], "note.txt", { type: "text/plain" });

  await assert.rejects(storeImageUpload(env, identity, "boundary", file), /Only PNG, JPEG, WebP, or GIF images are supported/);
  assert.equal(stored.length, 0);
});

test("storeImageUpload rejects an empty file", async () => {
  const { env, stored } = createUploadsEnv();
  const file = new File([], "empty.png", { type: "image/png" });

  await assert.rejects(storeImageUpload(env, identity, "boundary", file), /Image must be between 1 byte and 10 MB/);
  assert.equal(stored.length, 0);
});

test("storeImageUpload accepts a filename extension that disagrees with its MIME type", async () => {
  const { env, stored } = createUploadsEnv();
  const file = imageFile("image/jpeg", "portrait.png");

  const attachment = await storeImageUpload(env, identity, "boundary", file);

  assert.equal(attachment.name, "portrait.png");
  assert.equal(attachment.mime, "image/jpeg");
  assert.match(attachment.key, /\.jpg$/);
  assert.equal(stored[0]?.originalName, "portrait.png");
  assertOwnedUploadKey(identity, attachment.key);
});

test("storeImageUpload rejects truncated image signatures before writing to R2", async () => {
  for (const [mime] of Object.entries(imageSignatures) as Array<[ImageType, Uint8Array]>) {
    const { env, stored } = createUploadsEnv();
    const file = imageFile(mime, `truncated.${mime.split("/")[1]}`, imageSignatures[mime].slice(0, -1));

    await assert.rejects(storeImageUpload(env, identity, "boundary", file), /Image contents do not match its declared type/);
    assert.equal(stored.length, 0);
  }
});

test("storeImageUpload rejects mismatched and arbitrary image bytes before writing to R2", async () => {
  const invalidFiles: Array<[ImageType, string, Uint8Array<ArrayBuffer>]> = [
    ["image/png", "mismatch.png", imageSignatures["image/jpeg"]],
    ["image/jpeg", "arbitrary.jpg", new TextEncoder().encode("not an image")],
    ["image/webp", "mismatch.webp", imageSignatures["image/gif"]],
    ["image/gif", "mismatch.gif", imageSignatures["image/png"]],
  ];

  for (const [mime, name, bytes] of invalidFiles) {
    const { env, stored } = createUploadsEnv();

    await assert.rejects(storeImageUpload(env, identity, "boundary", imageFile(mime, name, bytes)), /Image contents do not match its declared type/);
    assert.equal(stored.length, 0);
  }
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
