import { SignJWT, importJWK } from "jose";
import type { Env } from "./types";
import { safePublicHttpUrl } from "./public-url";

export interface PushSubscription {
  endpoint: string;
  keys: { auth: string; p256dh: string };
}

function vapid(env: Env) {
  return { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
}
export function publicVapidKey(env: Env): string {
  return env.VAPID_PUBLIC_KEY;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
async function hmac(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", exactBuffer(keyBytes), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, exactBuffer(data)));
}
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  // Every Web Push expansion below is <= SHA-256's 32-byte block size.
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

async function vapidAuthorization(endpoint: string, keys: ReturnType<typeof vapid>): Promise<string> {
  const publicBytes = decodeBase64Url(keys.publicKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) throw new Error("VAPID public key must be an uncompressed P-256 point");
  const signingKey = await importJWK({
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(publicBytes.slice(1, 33)),
    y: encodeBase64Url(publicBytes.slice(33, 65)),
    d: keys.privateKey,
  }, "ES256");
  const token = await new SignJWT({})
    .setProtectedHeader({ typ: "JWT", alg: "ES256" })
    .setAudience(new URL(endpoint).origin)
    .setSubject(keys.subject)
    .setExpirationTime(Math.floor(Date.now() / 1000) + 12 * 60 * 60)
    .sign(signingKey);
  return `vapid t=${token}, k=${keys.publicKey}`;
}

/** RFC 8291 aes128gcm body. The previous dependency emitted the obsolete
 * draft aesgcm wire format, which modern Apple Push and FCM reject. */
async function encryptAes128Gcm(subscription: PushSubscription, data: Uint8Array): Promise<Uint8Array> {
  const clientPublic = decodeBase64Url(subscription.keys.p256dh);
  const authSecret = decodeBase64Url(subscription.keys.auth);
  if (clientPublic.length !== 65 || clientPublic[0] !== 4) throw new Error("Push subscription p256dh key is invalid");
  if (!authSecret.length) throw new Error("Push subscription auth secret is missing");

  const clientKey = await crypto.subtle.importKey("raw", exactBuffer(clientPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, local.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const authPrk = await hmac(authSecret, sharedSecret);
  const ikm = await hkdfExpand(authPrk, concat(utf8("WebPush: info\0"), clientPublic, localPublic), 32);
  const prk = await hmac(salt, ikm);
  const cek = await hkdfExpand(prk, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, utf8("Content-Encoding: nonce\0"), 12);
  const recordPlaintext = concat(data, new Uint8Array([2]));
  if (recordPlaintext.length > 4_080) throw new Error("Push payload is too large");
  const contentKey = await crypto.subtle.importKey("raw", exactBuffer(cek), { name: "AES-GCM", length: 128 }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: exactBuffer(nonce) }, contentKey, exactBuffer(recordPlaintext)));
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([localPublic.length]), localPublic, ciphertext);
}

export async function sendPush(env: Env, subscription: PushSubscription, data: Record<string, unknown>, ttl = 60) {
  if (!safePublicHttpUrl(subscription.endpoint, { httpsOnly: true })) throw new Error("Unsafe Web Push endpoint");
  const body = await encryptAes128Gcm(subscription, utf8(JSON.stringify(data)));
  return fetch(subscription.endpoint, {
    redirect: "manual",
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, vapid(env)),
      "Content-Encoding": "aes128gcm",
      "Content-Length": String(body.byteLength),
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: "normal",
    },
    body: exactBuffer(body),
  });
}
export async function sendTestPush(env: Env, subscription: PushSubscription) {
  return sendPush(env, subscription, { title: "my · ax", body: "Web Push is working.", href: "/" });
}
