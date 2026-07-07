import assert from "node:assert/strict";
import test from "node:test";
import type { AccessIdentity } from "./auth";
import type { Env } from "./types";
import {
  createAudioMessage,
  getAudioMessageObject,
  normalizeVoice,
  AUDIO_VOICES,
} from "./audio-messages";

const identity: AccessIdentity = { email: "Owner@Example.com", sub: "owner" };
const SESSION = "123e4567-e89b-12d3-a456-426614174000";
const AUDIO_ID_RE = /^audio\/owner@example\.com\/123e4567-e89b-12d3-a456-426614174000\/[0-9a-f-]{36}\.mp3$/;

function fakeDbFor(rows: Record<string, unknown>) {
  // Minimal D1 stub: SELECT session ownership returns a row; INSERT/DELETE no-op.
  return {
    prepare(sql: string) {
      const bindings: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bindings.push(...args); return stmt; },
        async first() {
          if (/FROM sessions/.test(sql)) return rows.session ?? null;
          if (/FROM audio_messages/.test(sql)) return rows.audio ?? null;
          return null;
        },
        async run() { return { success: true }; },
        async all() { return { results: [] }; },
      };
      return stmt;
    },
  };
}

function baseEnv(put: (key: string, bytes: Uint8Array) => void, db: unknown): Env {
  return {
    USER_UPLOADS: {
      put: async (key: string, bytes: Uint8Array) => { put(key, bytes); },
      get: async (key: string) => ({ key, body: new Uint8Array([1, 2, 3]) }),
      delete: async () => undefined,
    },
    DB: db,
    LLM_GATEWAY_URL: "https://gateway.example/openai",
    LLM_GATEWAY_TOKEN: "tok",
  } as unknown as Env;
}

test("normalizeVoice accepts the closed allowlist and defaults otherwise", () => {
  for (const voice of AUDIO_VOICES) assert.equal(normalizeVoice(voice), voice);
  assert.equal(normalizeVoice("villain"), "alloy");
  assert.equal(normalizeVoice(undefined), "alloy");
  assert.equal(normalizeVoice(42), "alloy");
});

test("createAudioMessage synthesizes, stores an owner-scoped mp3, and returns a same-origin src", async () => {
  const stored: Array<{ key: string; bytes: Uint8Array }> = [];
  const env = baseEnv((key, bytes) => stored.push({ key, bytes }), fakeDbFor({ session: { id: SESSION } }));
  const originalFetch = globalThis.fetch;
  let requested: { url: string; body: any } | null = null;
  globalThis.fetch = (async (url: string, init: any) => {
    requested = { url, body: JSON.parse(init.body) };
    return new Response(new Uint8Array([0x49, 0x44, 0x33]), { status: 200 });
  }) as typeof fetch;
  try {
    const clip = await createAudioMessage(env, identity, SESSION, { text: "Hello there", voice: "nova" });
    assert.equal(clip.kind, "audio-message");
    assert.equal(clip.voice, "nova");
    assert.match(clip.src, /^\/api\/audio\/[0-9a-f-]{36}$/);
    assert.equal(clip.src, `/api/audio/${clip.audioId}`);
    assert.equal(stored.length, 1);
    assert.match(stored[0].key, AUDIO_ID_RE);
    assert.ok(Date.parse(clip.expiresAt) > Date.parse(clip.createdAt));
    // 7-day TTL window.
    assert.equal(Math.round((Date.parse(clip.expiresAt) - Date.parse(clip.createdAt)) / 86_400_000), 7);
    assert.equal(requested!.url, "https://gateway.example/openai/audio/speech");
    assert.equal(requested!.body.voice, "nova");
    assert.equal(requested!.body.response_format, "mp3");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createAudioMessage rejects text over the one-minute cap", async () => {
  const env = baseEnv(() => {}, fakeDbFor({ session: { id: SESSION } }));
  await assert.rejects(
    createAudioMessage(env, identity, SESSION, { text: "x".repeat(1001) }),
    /under a minute|exceeds/i,
  );
});

test("createAudioMessage fails closed when the conversation is not owned", async () => {
  const env = baseEnv(() => {}, fakeDbFor({ session: null }));
  await assert.rejects(
    createAudioMessage(env, identity, SESSION, { text: "Hi" }),
    /not found or is not owned/,
  );
});

test("getAudioMessageObject rejects malformed ids before reading storage", async () => {
  let reads = 0;
  const env = {
    USER_UPLOADS: { get: async () => { reads++; return null; }, delete: async () => undefined },
    DB: fakeDbFor({}),
  } as unknown as Env;
  const result = await getAudioMessageObject(env, identity, "not-a-uuid");
  assert.equal(result, null);
  assert.equal(reads, 0);
});

test("getAudioMessageObject treats an expired clip as gone", async () => {
  const past = new Date(Date.now() - 1000).toISOString();
  let deleted = 0;
  const env = {
    USER_UPLOADS: {
      get: async () => ({ body: new Uint8Array([1]) }),
      delete: async () => { deleted++; },
    },
    DB: fakeDbFor({ audio: { storage_key: "audio/owner@example.com/s/x.mp3", expires_at: past } }),
  } as unknown as Env;
  const result = await getAudioMessageObject(env, identity, "123e4567-e89b-12d3-a456-426614174000");
  assert.equal(result, null);
  assert.equal(deleted, 1);
});

test("getAudioMessageObject returns a live clip within its TTL", async () => {
  const future = new Date(Date.now() + 1000).toISOString();
  const env = {
    USER_UPLOADS: {
      get: async (key: string) => ({ key, body: new Uint8Array([1]) }),
      delete: async () => undefined,
    },
    DB: fakeDbFor({ audio: { storage_key: "audio/owner@example.com/s/x.mp3", expires_at: future } }),
  } as unknown as Env;
  const result = await getAudioMessageObject(env, identity, "123e4567-e89b-12d3-a456-426614174000");
  assert.ok(result);
  assert.equal((result as { key: string }).key, "audio/owner@example.com/s/x.mp3");
});
