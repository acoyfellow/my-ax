// grant-crypto.ts
//
// Symmetric encryption for OAuth tokens stored in OAuthClientDO.
//
// Pattern lifted from cto-agent/apps/oauth-proxy/src/grant-crypto.ts:
//   - AES-GCM-256
//   - per-value 16-byte random salt + 12-byte random IV
//   - per-user key derived via HKDF-SHA256 from MASTER_KEY + userScope
//   - associated-data ties ciphertext to (userScope, version) so blobs can't
//     be replayed across users or contexts
//
// Wire format:
//   v1.<base64url(salt)>.<base64url(iv)>.<base64url(ciphertext+tag)>
//
// The version prefix lets us evolve the algorithm without breaking existing
// blobs. Currently only v1.

const VERSION = "v1";
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_INFO = new TextEncoder().encode("my-ax-oauth-token-v1");

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────
function b64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4;
  const padded = s + "=".repeat(pad === 0 ? 0 : 4 - pad);
  const std = padded.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Workers webcrypto types are strict about ArrayBuffer (not ArrayBufferLike).
// Wrap byte arrays into BufferSources backed by plain ArrayBuffers.
function asBufferSource(b: Uint8Array): ArrayBuffer {
  // Slice creates a fresh ArrayBuffer-backed copy.
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

async function importMasterKey(masterKeyBase64: string): Promise<CryptoKey> {
  const raw = b64UrlDecode(masterKeyBase64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"));
  if (raw.length < 32) {
    throw new Error(`MASTER_KEY too short: ${raw.length} bytes (need >= 32)`);
  }
  return crypto.subtle.importKey("raw", asBufferSource(raw), { name: "HKDF" }, false, ["deriveKey"]);
}

async function deriveUserKey(
  masterKey: CryptoKey,
  userScope: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const info = new Uint8Array([
    ...KEY_INFO,
    0x00,
    ...new TextEncoder().encode(userScope),
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: asBufferSource(salt), info: asBufferSource(info) },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ──────────────────────────────────────────────────────────────────────
// public API
// ──────────────────────────────────────────────────────────────────────
export async function encryptToken(
  masterKeyBase64: string,
  userScope: string,
  plaintext: string,
): Promise<string> {
  const masterKey = await importMasterKey(masterKeyBase64);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const aad = new TextEncoder().encode(`${VERSION}|${userScope}`);
  const userKey = await deriveUserKey(masterKey, userScope, salt);
  const pt = new TextEncoder().encode(plaintext);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBufferSource(iv), additionalData: asBufferSource(aad), tagLength: 128 },
      userKey,
      asBufferSource(pt),
    ),
  );
  return [VERSION, b64UrlEncode(salt), b64UrlEncode(iv), b64UrlEncode(ct)].join(".");
}

export async function decryptToken(
  masterKeyBase64: string,
  userScope: string,
  blob: string,
): Promise<string> {
  const parts = blob.split(".");
  if (parts.length !== 4) throw new Error(`malformed blob: expected 4 parts, got ${parts.length}`);
  const [v, saltB64, ivB64, ctB64] = parts;
  if (v !== VERSION) throw new Error(`unsupported encryption version: ${v}`);
  const salt = b64UrlDecode(saltB64);
  const iv = b64UrlDecode(ivB64);
  const ct = b64UrlDecode(ctB64);
  const masterKey = await importMasterKey(masterKeyBase64);
  const aad = new TextEncoder().encode(`${VERSION}|${userScope}`);
  const userKey = await deriveUserKey(masterKey, userScope, salt);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBufferSource(iv), additionalData: asBufferSource(aad), tagLength: 128 },
    userKey,
    asBufferSource(ct),
  );
  return new TextDecoder().decode(pt);
}

// Detect whether a stored value is a v1 blob or a legacy plaintext token.
// Lets us roll out encryption without invalidating existing tokens — first
// time we read a plaintext token, we re-encrypt it.
export function looksEncrypted(value: string): boolean {
  return /^v\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}
