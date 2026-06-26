#!/usr/bin/env node
/** Authenticated HTTP proof that every visible model completes a real turn. */
const BASE = process.env.MY_AX_BASE_URL;
const TOKEN = process.env.MY_AX_ACCESS_TOKEN;
const TIMEOUT_MS = Number(process.env.MY_AX_MODEL_PROOF_TIMEOUT_MS || 300_000);
const KEEP_SESSIONS = process.env.MY_AX_MODEL_PROOF_KEEP_SESSIONS === "1";
if (!BASE || !TOKEN) {
  console.error("MY_AX_BASE_URL and MY_AX_ACCESS_TOKEN required");
  process.exit(2);
}
const headers = { "cf-access-token": TOKEN };
async function api(path, options = {}) {
  const r = await fetch(new URL(path, BASE), {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
  if (!r.ok) throw new Error(`${options.method || "GET"} ${path} -> ${r.status} ${JSON.stringify(body)}`);
  return body;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function proveModel(model) {
  const marker = `MODEL_E2E_OK_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let sessionId;
  const startedAt = Date.now();
  try {
    const created = await api("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `Model proof · ${model.label}` }) });
    sessionId = created.result.sessionId;
    const setModel = await api(`/api/sessions/${encodeURIComponent(sessionId)}/model`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: model.id, reasoningEffort: "low" }) });
    if (setModel.ok !== true) throw new Error(`model set failed: ${JSON.stringify(setModel)}`);
    await api(`/api/sessions/${encodeURIComponent(sessionId)}/inject`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: `Reply with exactly this text and no extra words: ${marker}`, clientMsgId: `model-proof-${marker}` }) });
    const deadline = Date.now() + TIMEOUT_MS;
    let lastEntries = [];
    while (Date.now() < deadline) {
      const entriesBody = await api(`/api/sessions/${encodeURIComponent(sessionId)}/entries?limit=100`);
      const entries = entriesBody.result?.entries ?? [];
      lastEntries = entries;
      const assistant = entries.filter((entry) => entry.role === "assistant");
      const errorEntries = entries.filter((entry) => entry.isError || entry.is_error || (entry.role === "assistant" && /an error occurred|model|gateway|upstream|unauthorized|not found|invalid/i.test(entry.content || "")));
      if (assistant.some((entry) => String(entry.content || "").includes(marker))) {
        return { status: "pass", sessionId, marker, durationMs: Date.now() - startedAt };
      }
      if (errorEntries.length) return { status: "fail", sessionId, marker, errors: errorEntries.slice(-4), entries: lastEntries.slice(-8) };
      await sleep(2000);
    }
    return { status: "fail", sessionId, marker, timeoutMs: TIMEOUT_MS, entries: lastEntries.slice(-8) };
  } catch (error) {
    return { status: "fail", sessionId, marker, error: error.message || String(error) };
  } finally {
    if (sessionId && !KEEP_SESSIONS) {
      try { await api(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }); } catch {}
    }
  }
}
const health = await api("/api/health");
if (health.ok !== true) throw new Error(`health not ok: ${JSON.stringify(health)}`);
const catalog = await api("/api/models/catalog");
const models = catalog.result?.data ?? [];
if (!models.length) throw new Error("empty model catalog");
if (models.some((m) => /alpha/i.test(`${m.label} ${m.id}`))) throw new Error(`alpha row visible: ${JSON.stringify(models)}`);
const requiredModels = (process.env.MY_AX_REQUIRED_MODELS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
for (const required of requiredModels) {
  if (!models.some((m) => m.id === required)) throw new Error(`required model missing: ${required}`);
}
console.log(`target=${BASE}`);
console.log(`models=${models.map((m) => `${m.label}<${m.id}>`).join(", ")}`);
const results = [];
for (const model of models) {
  const detail = await proveModel(model);
  const row = { model: { id: model.id, label: model.label, owned_by: model.owned_by }, ...detail };
  results.push(row);
  console.log(`${row.status.toUpperCase()} ${model.label} <${model.id}> ${JSON.stringify(detail)}`);
}
const failed = results.filter((r) => r.status !== "pass");
console.log(JSON.stringify({ target: BASE, passed: results.length - failed.length, total: results.length, results }, null, 2));
if (failed.length) process.exit(1);
