import { compile, VERSION } from "svelte/compiler";
import type { AccessIdentity } from "./auth";
import type { Env } from "./types";
import { createWidgetRecord, deleteUnsavedSessionWidgets, deleteWidgetRecord, setWidgetSourceHash, setWidgetTitle, type WidgetDb } from "./domain/Widget/Widget.store";

const widgetDb = (env: Env) => env.DB as unknown as WidgetDb;

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
  updated_at: string;
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
    throw new Error("Widget source cannot use module scripts.");
  }

  const scripts = source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi);
  for (const script of scripts) {
    const body = script[1] ?? "";
    // Keep the first artifact slice self-contained: no static/dynamic module
    // imports or CommonJS require calls in instance scripts.
    if (/(?:^|[;\n}]\s*)import\s+(?:["'{*\w])|\bimport\s*\(|\brequire\s*\(/m.test(body)) {
      throw new Error("Widget source cannot import external modules.");
    }
  }
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cleanWidgetSource(input: string): string {
  const source = input.trim().replace(/\r\n?/g, "\n");
  if (!source) throw new Error("Widget source is empty.");
  const sourceBytes = new TextEncoder().encode(source).byteLength;
  if (sourceBytes > MAX_SOURCE_BYTES) throw new Error(`Artifact source exceeds ${MAX_SOURCE_BYTES} bytes.`);
  assertSelfContainedSource(source);
  return source;
}

function compileWidget(source: string): { clientJs: string; css: string } {
  try {
    const compiled = compile(source, { generate: "client", dev: false, name: "MyAxArtifact" });
    return { clientJs: compiled.js.code, css: compiled.css?.code ?? "" };
  } catch (error) {
    throw new Error(`Svelte compile failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function updateOwnedArtifactSource(env: Env, identity: AccessIdentity, id: string, sourceInput: string): Promise<{ artifactId: string; title: string; src: string; sourceHash: string } | null> {
  const row = await getOwnedArtifactRow(env, identity, id);
  if (!row || row.kind !== "svelte-widget") return null;
  const source = cleanWidgetSource(sourceInput);
  const compiled = compileWidget(source);
  const sourceHash = await sha256(source);
  const updatedAt = new Date().toISOString();
  const manifest: SvelteArtifactManifest = {
    schema: "my-ax.svelte-artifact.v1",
    id: row.id,
    kind: "svelte-widget",
    title: row.title,
    source,
    sourceHash,
    clientJs: compiled.clientJs,
    css: compiled.css,
    svelteVersion: VERSION,
    createdAt: row.created_at,
  };
  await bucket(env).put(row.storage_key, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { owner: normalizedEmail(identity), sessionId: row.session_id, kind: manifest.kind, sourceHash },
  });
  await setWidgetSourceHash(widgetDb(env), normalizedEmail(identity), row.id, sourceHash, updatedAt);
  return { artifactId: row.id, title: row.title, src: `/api/artifacts/${row.id}/preview`, sourceHash };
}

export async function createSvelteArtifact(env: Env, identity: AccessIdentity, sessionId: string, input: { title: string; source: string }) {
  const title = input.title.trim().slice(0, MAX_TITLE_CHARS);
  if (!title) throw new Error("Widget title is required.");
  const source = cleanWidgetSource(input.source);

  const ownerEmail = normalizedEmail(identity);
  const owned = await env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ?")
    .bind(sessionId, ownerEmail).first<{ id: string }>();
  if (!owned) throw new Error("Widget conversation was not found or is not owned by the current user.");

  const sourceHash = await sha256(source);
  const existing = await env.DB.prepare("SELECT id, title FROM artifacts WHERE owner_email = ? AND source_hash = ? ORDER BY created_at DESC LIMIT 1")
    .bind(ownerEmail, sourceHash).first<{ id: string; title: string }>();
  if (existing) {
    return { kind: "svelte-artifact" as const, artifactId: existing.id, title: existing.title, src: `/api/artifacts/${existing.id}/preview`, sourceHash, reused: true };
  }

  const compiled = compileWidget(source);

  const id = crypto.randomUUID();
  const storageKey = widgetStorageKey(identity, sessionId, id);
  const createdAt = new Date().toISOString();
  const manifest: SvelteArtifactManifest = {
    schema: "my-ax.svelte-artifact.v1",
    id,
    kind: "svelte-widget",
    title,
    source,
    sourceHash,
    clientJs: compiled.clientJs,
    css: compiled.css,
    svelteVersion: VERSION,
    createdAt,
  };

  await bucket(env).put(storageKey, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { owner: ownerEmail, sessionId, kind: manifest.kind, sourceHash },
  });
  try {
    await createWidgetRecord(widgetDb(env), { id, owner: ownerEmail, sessionId, kind: manifest.kind, title, storageKey, sourceHash, createdAt });
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
  return env.DB.prepare("SELECT id, owner_email, session_id, kind, title, storage_key, source_hash, created_at, COALESCE(updated_at, created_at) AS updated_at FROM artifacts WHERE id = ? AND owner_email = ?")
    .bind(id, normalizedEmail(identity)).first<ArtifactRow>();
}

export async function listOwnedArtifacts(env: Env, identity: AccessIdentity, limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 100, 200));
  const result = await env.DB.prepare("SELECT id, session_id, kind, title, source_hash, created_at, COALESCE(updated_at, created_at) AS updated_at FROM artifacts WHERE owner_email = ? ORDER BY COALESCE(updated_at, created_at) DESC LIMIT ?")
    .bind(normalizedEmail(identity), safeLimit).all<{ id: string; session_id: string; kind: string; title: string; source_hash: string; created_at: string; updated_at: string }>();
  return (result.results ?? []).map((row) => ({ id: row.id, sessionId: row.session_id, kind: row.kind, title: row.title, sourceHash: row.source_hash, createdAt: row.created_at, updatedAt: row.updated_at }));
}

export async function searchOwnedArtifacts(env: Env, identity: AccessIdentity, queryInput: string, limit = 10) {
  const query = queryInput.trim().toLowerCase();
  if (!query) return [];
  const tokens = [...new Set(query.match(/[\p{L}\p{N}]+/gu) ?? [])].filter((token) => token.length > 1);
  if (!tokens.length) return [];
  const artifacts = await listOwnedArtifacts(env, identity, 200);
  const scored = artifacts.map((artifact) => {
    const title = artifact.title.toLowerCase();
    const titleTokens = new Set(title.match(/[\p{L}\p{N}]+/gu) ?? []);
    const overlap = tokens.filter((token) => titleTokens.has(token)).length;
    const score = (title === query ? 100 : 0) + (title.includes(query) ? 40 : 0) + overlap * 10 + overlap / Math.max(tokens.length, titleTokens.size, 1);
    return { ...artifact, score };
  }).filter((artifact) => artifact.score > 0);
  return scored.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt)).slice(0, Math.max(1, Math.min(Math.floor(limit), 20)));
}

export async function renameOwnedArtifact(env: Env, identity: AccessIdentity, id: string, titleInput: string): Promise<boolean> {
  if (!ARTIFACT_ID_RE.test(id)) return false;
  const title = titleInput.trim().slice(0, MAX_TITLE_CHARS);
  if (!title) throw new Error("Widget title is required.");
  return setWidgetTitle(widgetDb(env), normalizedEmail(identity), id, title, new Date().toISOString());
}

export async function deleteOwnedArtifact(env: Env, identity: AccessIdentity, id: string): Promise<boolean> {
  const row = await getOwnedArtifactRow(env, identity, id);
  if (!row) return false;
  await deleteWidgetRecord(widgetDb(env), normalizedEmail(identity), id);
  await bucket(env).delete(row.storage_key).catch((error) => {
    console.error("artifact_object_delete_failed", { artifactId: id, err: error instanceof Error ? error.message : String(error) });
  });
  return true;
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
  const keys = await deleteUnsavedSessionWidgets(widgetDb(env), ownerEmail, sessionId);
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
