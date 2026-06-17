#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";

const BASE = process.env.MY_AX_BASE_URL;
const owner = process.env.MY_AX_OWNER_EMAIL;
if (!BASE || !owner) {
  console.error("MY_AX_BASE_URL and MY_AX_OWNER_EMAIL env vars required");
  process.exit(2);
}
const marker = `artifact-proof-${Date.now()}`;
const artifactId = crypto.randomUUID();
let sessionId = null;
let temp = null;
let accessToken = null;

function token() {
  accessToken ??= execFileSync("cloudflared", ["access", "token", `--app=${BASE}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  return accessToken;
}
async function request(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { "cf-access-token": token(), ...(init.headers ?? {}) }, redirect: "manual" });
  const text = await response.text();
  return { response, text };
}
async function json(path, init = {}) {
  const { response, text } = await request(path, init);
  let body;
  try { body = JSON.parse(text); } catch { body = { text }; }
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${response.status}: ${text.slice(0, 500)}`);
  return body;
}
function wrangler(...args) {
  return execFileSync("./node_modules/.bin/wrangler", args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}
function sql(query) {
  wrangler("d1", "execute", "pai-ax-db", "--remote", "--command", query);
}
function r2(command, key, file) {
  const args = ["r2", "object", command, `pai-ax-uploads/${key}`, "--remote"];
  if (file) args.push("--file", file);
  return wrangler(...args);
}
function sqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

try {
  const created = await json("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: marker }) });
  sessionId = created.result.sessionId;
  console.log(`✓ session created ${sessionId}`);
  const key = `artifacts/${owner}/${sessionId}/${artifactId}.svelte-widget.json`;
  const manifest = {
    schema: "my-ax.svelte-artifact.v1", id: artifactId, kind: "svelte-widget", title: marker,
    source: "<button>proof</button>", sourceHash: marker, clientJs: "export default function MyAxArtifact(anchor){const b=document.createElement('button');b.textContent='proof';anchor.append(b)}", css: "", svelteVersion: "5", createdAt: new Date().toISOString(),
  };
  temp = `/tmp/${artifactId}.json`;
  writeFileSync(temp, JSON.stringify(manifest));
  r2("put", key, temp);
  sql(`INSERT INTO artifacts (id, owner_email, session_id, kind, title, storage_key, source_hash, created_at) VALUES ('${sqlLiteral(artifactId)}', '${sqlLiteral(owner)}', '${sqlLiteral(sessionId)}', 'svelte-widget', '${sqlLiteral(marker)}', '${sqlLiteral(key)}', '${sqlLiteral(marker)}', datetime('now'))`);
  console.log(`✓ persisted seeded artifact ${artifactId}`);

  const list = await json("/api/artifacts");
  if (!list.result.artifacts.some((artifact) => artifact.id === artifactId && artifact.sessionId === sessionId)) throw new Error("artifact index did not return seeded owner artifact");
  console.log("✓ owner-scoped artifact index returns persisted artifact");

  const preview = await request(`/api/artifacts/${artifactId}/preview`);
  if (!preview.response.ok || !preview.text.includes("proof") || !preview.text.includes('import Component from "data:application/javascript')) throw new Error(`preview missing: ${preview.response.status}`);
  console.log("✓ persisted artifact preview is retrievable");

  const other = await request(`/api/artifacts/${crypto.randomUUID()}/preview`);
  if (other.response.status !== 404) throw new Error(`unknown artifact was visible: ${other.response.status}`);
  console.log("✓ unknown artifact does not resolve through owner-scoped preview route");

  await json(`/api/sessions/${sessionId}`, { method: "DELETE" });
  sessionId = null;
  console.log("✓ conversation deleted");

  const after = await request(`/api/artifacts/${artifactId}/preview`);
  if (after.response.status !== 404) throw new Error(`artifact preview survived conversation delete: ${after.response.status}`);
  console.log("✓ artifact preview deleted with conversation");

  const listAfter = await json("/api/artifacts");
  if (listAfter.result.artifacts.some((artifact) => artifact.id === artifactId)) throw new Error("artifact row survived cleanup");
  console.log("✓ owner-scoped artifact row removed with conversation");
} finally {
  if (sessionId) await request(`/api/sessions/${sessionId}`, { method: "DELETE" }).catch(() => undefined);
  if (temp) { try { unlinkSync(temp); } catch {} }
}
