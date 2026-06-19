import assert from "node:assert/strict";
import test from "node:test";
import type { AccessIdentity } from "./auth";
import type { Env } from "./types";
import { assertOwnedUploadKey, storeImageUpload } from "./uploads";

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
