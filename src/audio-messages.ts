import type { AccessIdentity } from "./auth";
import type { Env } from "./types";
import { gatewayConfig } from "./llm";

// Audio Messages: short agent-generated TTS clips delivered into a
// conversation and rendered inline like Svelte artifacts. MVP scope keeps
// clips small (well under a minute) and owner-scoped, with a 7-day TTL.

const MAX_TEXT_CHARS = 1_000; // ~1 minute of speech at a natural pace
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const AUDIO_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// OpenAI TTS voices. Kept as a closed allowlist so a tool argument can never
// smuggle an arbitrary string into the upstream request.
export const AUDIO_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
export type AudioVoice = (typeof AUDIO_VOICES)[number];
const DEFAULT_VOICE: AudioVoice = "alloy";

// tts-1 is the low-latency model; tts-1-hd trades latency for fidelity. MVP
// uses tts-1 for responsiveness on short clips.
const TTS_MODEL = "tts-1";

export type AudioMessage = {
  kind: "audio-message";
  audioId: string;
  title: string;
  voice: AudioVoice;
  src: string;
  bytes: number;
  createdAt: string;
  expiresAt: string;
};

type AudioRow = {
  id: string;
  owner_email: string;
  session_id: string;
  storage_key: string;
  text: string;
  voice: string;
  mime: string;
  bytes: number;
  created_at: string;
  expires_at: string;
};

function bucket(env: Env): R2Bucket {
  const value = (env as Env & { USER_UPLOADS?: R2Bucket }).USER_UPLOADS;
  if (!value) throw new Error("USER_UPLOADS R2 binding is not configured");
  return value;
}

function normalizedEmail(identity: AccessIdentity): string {
  return identity.email.toLowerCase();
}

export function normalizeVoice(voice: unknown): AudioVoice {
  return typeof voice === "string" && (AUDIO_VOICES as readonly string[]).includes(voice)
    ? (voice as AudioVoice)
    : DEFAULT_VOICE;
}

/** Short human-readable clip title derived from the spoken text. */
function deriveTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine || "Voice message";
}

/** Call the AI-gateway OpenAI TTS endpoint and return MP3 bytes. Reuses the
 *  same repaired LLM_GATEWAY_TOKEN/URL plumbing as chat models. */
async function synthesizeSpeech(env: Env, text: string, voice: AudioVoice): Promise<Uint8Array> {
  const gateway = gatewayConfig(env);
  // gatewayConfig.baseURL points at the OpenAI-compatible root (…/openai).
  // The audio speech endpoint is a sibling of chat/responses.
  const speechUrl = `${gateway.baseURL.replace(/\/$/, "")}/audio/speech`;
  const response = await fetch(speechUrl, {
    method: "POST",
    headers: { ...gateway.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice, input: text, response_format: "mp3" }),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`TTS request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length <= 0) throw new Error("TTS returned an empty audio clip");
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error("Generated audio clip is too large");
  return bytes;
}

/** Generate a TTS clip, store it in R2 with a 7-day TTL, and record it. */
export async function createAudioMessage(
  env: Env,
  identity: AccessIdentity,
  sessionId: string,
  input: { text: string; voice?: unknown },
): Promise<AudioMessage> {
  const text = String(input.text ?? "").trim();
  if (!text) throw new Error("Audio message text is required.");
  if (text.length > MAX_TEXT_CHARS) throw new Error(`Audio message text exceeds ${MAX_TEXT_CHARS} characters. Keep clips under a minute.`);
  const voice = normalizeVoice(input.voice);
  const ownerEmail = normalizedEmail(identity);

  const owned = await env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ?")
    .bind(sessionId, ownerEmail).first<{ id: string }>();
  if (!owned) throw new Error("Audio message conversation was not found or is not owned by the current user.");

  const bytes = await synthesizeSpeech(env, text, voice);

  const id = crypto.randomUUID();
  const storageKey = `audio/${ownerEmail}/${sessionId}/${id}.mp3`;
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + TTL_MS).toISOString();
  const mime = "audio/mpeg";

  await bucket(env).put(storageKey, bytes, {
    httpMetadata: { contentType: mime },
    customMetadata: { owner: ownerEmail, sessionId, kind: "audio-message", expiresAt },
  });
  try {
    await env.DB.prepare(`INSERT INTO audio_messages (id, owner_email, session_id, storage_key, text, voice, mime, bytes, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, ownerEmail, sessionId, storageKey, text, voice, mime, bytes.length, createdAt, expiresAt).run();
  } catch (error) {
    await bucket(env).delete(storageKey).catch(() => undefined);
    throw error;
  }

  return {
    kind: "audio-message",
    audioId: id,
    title: deriveTitle(text),
    voice,
    src: `/api/audio/${id}`,
    bytes: bytes.length,
    createdAt,
    expiresAt,
  };
}

/** Fetch a stored clip's bytes, enforcing owner scope and 7-day expiry. */
export async function getAudioMessageObject(env: Env, identity: AccessIdentity, id: string): Promise<R2ObjectBody | null> {
  if (!AUDIO_ID_RE.test(id)) return null;
  const row = await env.DB.prepare("SELECT storage_key, expires_at FROM audio_messages WHERE id = ? AND owner_email = ?")
    .bind(id, normalizedEmail(identity)).first<{ storage_key: string; expires_at: string }>();
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    // Expired: best-effort physical cleanup, then treat as gone.
    await bucket(env).delete(row.storage_key).catch(() => undefined);
    await env.DB.prepare("DELETE FROM audio_messages WHERE id = ? AND owner_email = ?").bind(id, normalizedEmail(identity)).run().catch(() => undefined);
    return null;
  }
  return bucket(env).get(row.storage_key);
}

export async function deleteSessionAudioMessages(env: Env, identity: AccessIdentity, sessionId: string): Promise<{ deleted: number }> {
  const ownerEmail = normalizedEmail(identity);
  const result = await env.DB.prepare("SELECT storage_key FROM audio_messages WHERE session_id = ? AND owner_email = ?")
    .bind(sessionId, ownerEmail).all<{ storage_key: string }>();
  const keys = (result.results ?? []).map((row) => row.storage_key);
  await env.DB.prepare("DELETE FROM audio_messages WHERE session_id = ? AND owner_email = ?").bind(sessionId, ownerEmail).run();
  if (keys.length) await bucket(env).delete(keys).catch((error) => {
    console.error("audio_message_cleanup_failed", { sessionId, ownerEmail, count: keys.length, err: error instanceof Error ? error.message : String(error) });
  });
  return { deleted: keys.length };
}

export type { AudioRow };
