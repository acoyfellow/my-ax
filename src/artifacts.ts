import { compile, VERSION } from "svelte/compiler";
import type { AccessIdentity } from "./auth";
import type { Env } from "./types";

const MAX_SOURCE_BYTES = 128 * 1024;
const MAX_TITLE_CHARS = 120;
const ARTIFACT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SvelteArtifactManifest = {
  schema: "my-ax.svelte-artifact.v1";
  id: string;
  kind: "svelte-widget";
  title: string;
  source: string;
  sourceHash: string;
  clientJs: string;
  css: string;
  svelteVersion: string;
  createdAt: string;
};

type ArtifactRow = {
  id: string;
  owner_email: string;
  session_id: string;
  kind: string;
  title: string;
  storage_key: string;
  source_hash: string;
  created_at: string;
};

function bucket(env: Env): R2Bucket {
  const value = (env as Env & { USER_UPLOADS?: R2Bucket }).USER_UPLOADS;
  if (!value) throw new Error("USER_UPLOADS R2 binding is not configured");
  return value;
}

function normalizedEmail(identity: AccessIdentity): string {
  return identity.email.toLowerCase();
}

function widgetStorageKey(identity: AccessIdentity, sessionId: string, id: string): string {
  return `artifacts/${normalizedEmail(identity)}/${sessionId}/${id}.svelte-widget.json`;
}

function assertSelfContainedSource(source: string): void {
  if (/<script\b[^>]*\bmodule\s*=/i.test(source) || /<script\b[^>]*\bcontext\s*=\s*["']module["']/i.test(source)) {
    throw new Error("Artifact source cannot use module scripts.");
  }

  const scripts = source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi);
  for (const script of scripts) {
    const body = script[1] ?? "";
    // Keep the first artifact slice self-contained: no static/dynamic module
    // imports or CommonJS require calls in instance scripts.
    if (/(?:^|[;\n}]\s*)import\s+(?:["'{*\w])|\bimport\s*\(|\brequire\s*\(/m.test(body)) {
      throw new Error("Artifact source cannot import external modules.");
    }
  }
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createSvelteArtifact(env: Env, identity: AccessIdentity, sessionId: string, input: { title: string; source: string }) {
  const title = input.title.trim().slice(0, MAX_TITLE_CHARS);
  const source = input.source.trim();
  if (!title) throw new Error("Artifact title is required.");
  if (!source) throw new Error("Artifact source is empty.");
  const sourceBytes = new TextEncoder().encode(source).byteLength;
  if (sourceBytes > MAX_SOURCE_BYTES) throw new Error(`Artifact source exceeds ${MAX_SOURCE_BYTES} bytes.`);

  assertSelfContainedSource(source);

  let compiled;
  try {
    compiled = compile(source, { generate: "client", dev: false, name: "MyAxArtifact" });
  } catch (error) {
    throw new Error(`Svelte compile failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const ownerEmail = normalizedEmail(identity);
  const owned = await env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ?")
    .bind(sessionId, ownerEmail).first<{ id: string }>();
  if (!owned) throw new Error("Artifact conversation was not found or is not owned by the current user.");

  const id = crypto.randomUUID();
  const sourceHash = await sha256(source);
  const storageKey = widgetStorageKey(identity, sessionId, id);
  const createdAt = new Date().toISOString();
  const manifest: SvelteArtifactManifest = {
    schema: "my-ax.svelte-artifact.v1",
    id,
    kind: "svelte-widget",
    title,
    source,
    sourceHash,
    clientJs: compiled.js.code,
    css: compiled.css?.code ?? "",
    svelteVersion: VERSION,
    createdAt,
  };

  await bucket(env).put(storageKey, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { owner: ownerEmail, sessionId, kind: manifest.kind, sourceHash },
  });
  try {
    await env.DB.prepare("INSERT INTO artifacts (id, owner_email, session_id, kind, title, storage_key, source_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, ownerEmail, sessionId, manifest.kind, title, storageKey, sourceHash, createdAt).run();
  } catch (error) {
    await bucket(env).delete(storageKey).catch(() => undefined);
    throw error;
  }

  return { kind: "svelte-artifact" as const, artifactId: id, title, src: `/api/artifacts/${id}/preview`, sourceHash };
}

function isSvelteArtifactManifest(value: unknown): value is SvelteArtifactManifest {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    m.schema === "my-ax.svelte-artifact.v1" &&
    m.kind === "svelte-widget" &&
    typeof m.id === "string" &&
    typeof m.title === "string" &&
    typeof m.source === "string" &&
    typeof m.sourceHash === "string" &&
    typeof m.clientJs === "string" &&
    typeof m.css === "string" &&
    typeof m.svelteVersion === "string" &&
    typeof m.createdAt === "string"
  );
}

export async function getOwnedArtifactRow(env: Env, identity: AccessIdentity, id: string): Promise<ArtifactRow | null> {
  if (!ARTIFACT_ID_RE.test(id)) return null;
  return env.DB.prepare("SELECT id, owner_email, session_id, kind, title, storage_key, source_hash, created_at FROM artifacts WHERE id = ? AND owner_email = ?")
    .bind(id, normalizedEmail(identity)).first<ArtifactRow>();
}

export async function listOwnedArtifacts(env: Env, identity: AccessIdentity, limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 100, 200));
  const result = await env.DB.prepare("SELECT id, session_id, kind, title, source_hash, created_at FROM artifacts WHERE owner_email = ? ORDER BY created_at DESC LIMIT ?")
    .bind(normalizedEmail(identity), safeLimit).all<{ id: string; session_id: string; kind: string; title: string; source_hash: string; created_at: string }>();
  return (result.results ?? []).map((row) => ({ id: row.id, sessionId: row.session_id, kind: row.kind, title: row.title, sourceHash: row.source_hash, createdAt: row.created_at }));
}

export async function readOwnedSvelteArtifact(env: Env, identity: AccessIdentity, id: string): Promise<SvelteArtifactManifest | null> {
  const row = await getOwnedArtifactRow(env, identity, id);
  if (!row || row.kind !== "svelte-widget") return null;
  const object = await bucket(env).get(row.storage_key);
  if (!object) return null;
  // object.json<T>() is a compile-time cast only. The manifest is rendered
  // straight into HTML downstream (css/title/clientJs .replace()), so a stored
  // object with a missing or non-string field would throw at render time.
  // Validate every field at the trust boundary and fail closed instead.
  let parsed: unknown;
  try { parsed = await object.json(); } catch { return null; }
  if (!isSvelteArtifactManifest(parsed) || parsed.id !== row.id || parsed.sourceHash !== row.source_hash) return null;
  return parsed;
}

export async function deleteSessionArtifacts(env: Env, identity: AccessIdentity, sessionId: string): Promise<{ deleted: number }> {
  const ownerEmail = normalizedEmail(identity);
  const result = await env.DB.prepare("SELECT storage_key FROM artifacts WHERE session_id = ? AND owner_email = ?")
    .bind(sessionId, ownerEmail).all<{ storage_key: string }>();
  const keys = (result.results ?? []).map((row) => row.storage_key);
  // Delete metadata first so a failed R2 cleanup can leave only unreachable
  // garbage rather than a now-deleted conversation's artifact still visible.
  await env.DB.prepare("DELETE FROM artifacts WHERE session_id = ? AND owner_email = ?").bind(sessionId, ownerEmail).run();
  if (keys.length) await bucket(env).delete(keys).catch((error) => {
    console.error("artifact_object_cleanup_failed", {
      sessionId,
      ownerEmail,
      count: keys.length,
      err: error instanceof Error ? error.message : String(error),
    });
  });
  return { deleted: keys.length };
}
