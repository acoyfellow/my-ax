import { execFileSync } from "node:child_process";

const TARGETS = { local: "http://127.0.0.1:8799", preview: "https://pr-alchemy.my.ax.cloudflare.dev", prod: "https://my.ax.cloudflare.dev" };
const requested = process.env.PROBE_URL ?? process.argv[2] ?? "";
const base = (TARGETS[requested] ?? requested).replace(/\/$/, "");
if (!base) {
  console.error("usage: PROBE_URL=https://host node verify/prod-write-probe.mjs");
  process.exit(2);
}

const local = /^http:\/\/(localhost|127\.0\.0\.1)/.test(base);
const token = local ? "" : execFileSync("cloudflared", ["access", "token", `-app=${base}`], { encoding: "utf8" }).trim();
const headers = { "content-type": "application/json", ...(token ? { "cf-access-token": token } : {}) };

const results = [];
const cleanup = [];

async function call(method, path, body) {
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json };
}

async function expect(label, method, path, body, status) {
  const response = await call(method, path, body);
  const ok = response.status === status;
  results.push({ label, method, path, status: response.status, expected: status, ok });
  return response;
}

const marker = `domain-probe-${Date.now()}`;
const recipeName = `domain_probe_${Date.now()}`;

try {
  const session = await expect("session create", "POST", "/api/sessions", { name: marker }, 201);
  const sessionId = session.json?.result?.sessionId;
  if (sessionId) cleanup.push(() => call("DELETE", `/api/sessions/${sessionId}`));

  const job = await expect("job create", "POST", "/api/jobs", { sessionId, threadMode: "same_session", name: marker, prompt: "domain probe: do nothing", cadenceSecs: 86400, maxRuns: 1 }, 201);
  const jobId = job.json?.result?.id ?? job.json?.result?.job?.id;
  if (jobId) {
    cleanup.push(() => call("DELETE", `/api/jobs/${jobId}`));
    await expect("job pause", "POST", `/api/jobs/${jobId}/pause`, {}, 200);
    await expect("job pause again is idempotent", "POST", `/api/jobs/${jobId}/pause`, {}, 200);
    await expect("job resume", "POST", `/api/jobs/${jobId}/resume`, {}, 200);
    await expect("job delete", "DELETE", `/api/jobs/${jobId}`, undefined, 200);
    cleanup.pop();
    await expect("job delete again is refused", "DELETE", `/api/jobs/${jobId}`, undefined, 404);
  }

  const recipe = await expect("recipe create", "POST", "/api/recipes", { name: recipeName, description: "domain probe recipe", code: "return 1;", capabilities: ["workspace.read"] }, 201);
  const recipeId = recipe.json?.result?.recipe?.id ?? recipe.json?.result?.id;
  if (recipeId) {
    cleanup.push(() => call("DELETE", `/api/recipes/${recipeId}`));
    await expect("recipe reject", "POST", `/api/recipes/${recipeId}/approval`, { action: "reject" }, 200);
    await expect("recipe edit", "PATCH", `/api/recipes/${recipeId}`, { description: "domain probe recipe edited" }, 200);
    await expect("recipe delete", "DELETE", `/api/recipes/${recipeId}`, undefined, 200);
    cleanup.pop();
    await expect("recipe delete again is refused", "DELETE", `/api/recipes/${recipeId}`, undefined, 404);
  }

  const run = await expect("run create", "POST", "/api/runs", { task: marker, session_id: sessionId }, 201);
  const runId = run.json?.result?.run?.id ?? run.json?.result?.runId ?? run.json?.result?.id;
  if (runId) {
    cleanup.push(() => call("POST", `/api/runs/${runId}/dismiss`, {}));
    await expect("run stop", "POST", `/api/runs/${runId}/stop`, { status: "aborted" }, 200);
    await expect("run stop again is refused", "POST", `/api/runs/${runId}/stop`, { status: "aborted" }, 409);
    await expect("run dismiss", "POST", `/api/runs/${runId}/dismiss`, {}, 200);
    cleanup.pop();
  }

  if (sessionId) {
    const before = await call("GET", "/api/domain/refusals");
    await expect("session delete", "DELETE", `/api/sessions/${sessionId}`, undefined, 200);
    cleanup.shift();
    await expect("rename after delete is refused by Domain", "PATCH", `/api/sessions/${sessionId}`, { name: "after delete" }, 404);
    const after = await call("GET", "/api/domain/refusals");
    const key = "Session.UpdateSessionDetails.SessionNotFound";
    const grew = (after.json?.result?.counts?.[key] ?? 0) > (before.json?.result?.counts?.[key] ?? 0);
    results.push({ label: "domain refusal is counted", method: "GET", path: "/api/domain/refusals", status: grew ? "counted" : "missing", expected: "counted", ok: grew });
  }
} finally {
  for (const undo of cleanup.reverse()) await undo().catch(() => undefined);
}

for (const row of results) console.log(`${row.ok ? "PASS" : "FAIL"} ${row.label}: ${row.method} ${row.path} -> ${row.status} (want ${row.expected})`);
const failed = results.filter((row) => !row.ok).length;
console.log(`probe ${base}: ${results.length - failed}/${results.length} pass, cleanup ${cleanup.length === 0 ? "done" : "attempted"}`);
process.exit(failed === 0 && results.length >= 15 ? 0 : 1);
