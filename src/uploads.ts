import type { Attachment, Env } from "./types";
import type { AccessIdentity } from "./auth";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const INLINE_RASTER_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/;
const ARTIFACT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uploadsBucket(env: Env): R2Bucket {
  const bucket = (env as Env & { USER_UPLOADS?: R2Bucket }).USER_UPLOADS;
  if (!bucket) throw new Error("USER_UPLOADS R2 binding is not configured");
  return bucket;
}

export function assertOwnedUploadKey(identity: AccessIdentity, key: string): void {
  const prefix = `uploads/${identity.email.toLowerCase()}/`;
  if (!key.startsWith(prefix) || key.includes("..")) throw new Error("upload not found");
}

function extForType(type: string): string {
  return type === "image/jpeg" ? "jpg" : type.split("/")[1] ?? "bin";
}

export async function storeImageUpload(
  env: Env,
  identity: AccessIdentity,
  sessionId: string,
  file: File,
): Promise<Attachment> {
  if (!IMAGE_TYPES.has(file.type)) throw new Error("Only PNG, JPEG, WebP, or GIF images are supported");
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error("Image must be between 1 byte and 10 MB");
  const id = crypto.randomUUID();
  // Session IDs originate in the client. Keep them a single R2 key segment so
  // every returned key remains readable through assertOwnedUploadKey.
  const safeSession = encodeURIComponent(sessionId || "draft").replace(/\./g, "%2E");
  const key = `uploads/${identity.email.toLowerCase()}/${safeSession}/${id}.${extForType(file.type)}`;
  await uploadsBucket(env).put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { originalName: file.name || "image", owner: identity.email.toLowerCase() },
  });
  return { id, kind: "image", mime: file.type, key, name: file.name || "image", bytes: file.size };
}

export async function getUploadObject(env: Env, identity: AccessIdentity, key: string): Promise<R2ObjectBody | null> {
  assertOwnedUploadKey(identity, key);
  return uploadsBucket(env).get(key);
}

export async function readUploadBytes(env: Env, identity: AccessIdentity, attachment: Attachment): Promise<Uint8Array> {
  assertOwnedUploadKey(identity, attachment.key);
  const obj = await uploadsBucket(env).get(attachment.key);
  if (!obj) throw new Error(`Missing image attachment: ${attachment.name ?? attachment.id}`);
  return new Uint8Array(await obj.arrayBuffer());
}

/** Normalize a laptop/tool screenshot out of transcript-sized base64 into an
 * owner-scoped R2 artifact. Returns null for non-raster tool output. */
export async function storeInlineRasterArtifact(env: Env, identity: AccessIdentity, value: string) {
  const match = INLINE_RASTER_RE.exec(value);
  if (!match) return null;
  const mime = match[1];
  const bytes = Uint8Array.from(atob(match[2].replace(/[\r\n]/g, "")), (char) => char.charCodeAt(0));
  if (bytes.length <= 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error("Screenshot artifact must be between 1 byte and 10 MB");
  const id = crypto.randomUUID();
  const key = `artifacts/${identity.email.toLowerCase()}/${id}.${extForType(mime)}`;
  await uploadsBucket(env).put(key, bytes, {
    httpMetadata: { contentType: mime },
    customMetadata: { owner: identity.email.toLowerCase(), kind: "tool-screenshot" },
  });
  return { kind: "raster-artifact" as const, src: `/api/artifacts/${id}`, mime, bytes: bytes.length };
}

export async function getRasterArtifact(env: Env, identity: AccessIdentity, id: string): Promise<R2ObjectBody | null> {
  if (!ARTIFACT_ID_RE.test(id)) throw new Error("artifact not found");
  const prefix = `artifacts/${identity.email.toLowerCase()}/${id}.`;
  for (const ext of ["png", "jpeg", "jpg", "webp", "gif"]) {
    const obj = await uploadsBucket(env).get(prefix + ext);
    if (obj) return obj;
  }
  return null;
}
