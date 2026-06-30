#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const base = process.env.MY_AX_BASE_URL ?? "https://my-ax.coey.dev";
const outPath = resolve(process.argv[2] ?? `proof/experiments/overhead-attribution-${new Date().toISOString().slice(0, 10)}.json`);
const model = "@cf/moonshotai/kimi-k2.7-code";
const authCookie = process.env.MY_AX_COOKIE;
const cyclesPerCondition = Number(process.env.MY_AX_OVERHEAD_CYCLES || 1);
const samples = [
  "api latency 210ms errors 2 region sfo",
  "api latency 190ms errors 0 region sfo",
];

async function api(path, init = {}) {
  const res = await fetch(`${base}${path}`, { headers: { "content-type": "application/json", ...(authCookie ? { cookie: authCookie } : {}), ...(init.headers ?? {}) }, ...init });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} ${res.status}: ${text.slice(0, 500)}`);
  return json;
}

async function waitForOneCycle(session, timeoutMs = 240_000) {
  const started = Date.now();
  let last = [];
  while (Date.now() - started < timeoutMs) {
    const json = await api(`/api/cost-series?session=${encodeURIComponent(session)}`);
    last = json.result?.series ?? [];
    if (last.length >= 1) return last[0];
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`timed out waiting for cycle_cost row; saw ${last.length}`);
}

async function createSession(name) {
  return (await api("/api/sessions", { method: "POST", body: JSON.stringify({ name }) })).result.sessionId;
}

async function inject(session, content) {
  await api(`/api/sessions/${session}/inject`, { method: "POST", body: JSON.stringify({ clientMsgId: crypto.randomUUID(), content }) });
}

async function deleteSession(session) {
  try { await api(`/api/sessions/${encodeURIComponent(session)}`, { method: "DELETE" }); return true; } catch { return false; }
}

function avg(rows, key) { return Math.round(rows.reduce((s, r) => s + Number(r[key] ?? 0), 0) / rows.length); }
function pctDrop(a, b) { return Math.round((1 - (b / a)) * 1000) / 10; }

const health = await api("/api/health");
if (!health.ok || !health.bindings?.AI) throw new Error(`health/AI binding not ready: ${JSON.stringify(health)}`);

const createdSessions = [];
const recipes = [];
const recipe = (await api("/api/recipes", {
  method: "POST",
  body: JSON.stringify({
    name: `normalize_status_digest_${Date.now().toString(36)}`,
    description: "Normalize a noisy service status line into a compact owner digest.",
    inputSchema: { type: "object", properties: { line: { type: "string" } }, required: ["line"] },
    capabilities: ["workspace.run_code"],
    sourceRunId: "overhead-attribution",
    status: "enabled",
    code: "const latencyMs = Number(input.line.match(/latency (\\d+)ms/)?.[1] ?? 0);\nconst errors = Number(input.line.match(/errors (\\d+)/)?.[1] ?? 0);\nconst region = input.line.match(/region (\\w+)/)?.[1] ?? 'unknown';\nconst health = errors ? 'degraded' : 'ok';\nreturn { region, health, latencyMs, errors, summary: `${region}: ${health}, ${latencyMs}ms, ${errors} errors` };",
  }),
})).result.recipe;
recipes.push(recipe);

const conditions = { A: [], B: [], C: [] };
try {
  for (const key of ["A", "B", "C"]) {
    for (let i = 0; i < cyclesPerCondition; i++) {
      const line = samples[i % samples.length];
      const session = await createSession(`overhead attribution ${key} ${new Date().toISOString()}`);
      createdSessions.push(session);
      const baseTask = `Parse status line ${JSON.stringify(line)} into compact JSON with region, health, latencyMs, errors, and summary. Keep output under 60 words.`;
      let content;
      if (key === "A") content = `MY_AX_RECIPE_CURVE_NO_TOOLS. OVERHEAD_ATTRIBUTION_A. Re-derive the procedure directly, with no tools: ${baseTask}`;
      if (key === "B") content = `OVERHEAD_ATTRIBUTION_B. Tools are available, but do not call any tool. Re-derive the procedure directly: ${baseTask}`;
      if (key === "C") content = `OVERHEAD_ATTRIBUTION_C. Do NOT re-derive or hand-write the parsing logic. Call work_code and inside it run the already-saved recipe: recipe.run({ name: ${JSON.stringify(recipe.name)}, input: { line: ${JSON.stringify(line)} } }) and return its result as the final JSON. Keep any prose under 30 words.`;
      await inject(session, content);
      const row = await waitForOneCycle(session);
      conditions[key].push({
        session,
        cycle: row.cycleIndex + 1,
        model: row.model,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        finishReason: row.finishReason,
        recipesUsed: row.recipesUsed,
        recipesSaved: row.recipesSaved,
        usageBasis: row.usageBasis,
      });
    }
  }
} finally {
  for (const r of recipes) {
    for (const path of [`/api/recipes/${encodeURIComponent(r.id)}`, `/api/recipes/${encodeURIComponent(r.name)}`]) {
      try { await api(path, { method: "DELETE" }); break; } catch {}
    }
  }
  for (const s of createdSessions) await deleteSession(s);
}

const averages = Object.fromEntries(Object.entries(conditions).map(([k, rows]) => [k, {
  inputTokens: avg(rows, "inputTokens"), outputTokens: avg(rows, "outputTokens"), totalTokens: avg(rows, "totalTokens"),
}]));
const attribution = {
  outputDropBvsA: pctDrop(averages.A.outputTokens, averages.B.outputTokens),
  outputDropCvsA: pctDrop(averages.A.outputTokens, averages.C.outputTokens),
  inputAddedByToolDefinitions_BminusA: averages.B.inputTokens - averages.A.inputTokens,
  inputAddedByRecipeRun_CminusB: averages.C.inputTokens - averages.B.inputTokens,
  totalDeltaCminusA: averages.C.totalTokens - averages.A.totalTokens,
  tinyProcedureTotalVerdict: averages.C.totalTokens < averages.A.totalTokens ? "reuse wins on total for this tiny procedure" : "reuse loses on total for this tiny procedure",
};

const artifact = { schemaVersion: 1, generatedAt: new Date().toISOString(), harness: "scripts/recipe-overhead-attribution.mjs", appBaseUrl: base, model, cyclesPerCondition, measuredSeriesKind: "real-workers-ai-provider-tokens", usageBasisRequired: "ai_sdk_step_usage", conditions, averages, attribution, cleanup: { attempted: true, sessions: createdSessions, recipes: recipes.map((r) => ({ id: r.id, name: r.name })) }, checks: { realModelRan: Object.values(conditions).flat().every((c) => c.totalTokens > 0), tokenUsagePresent: Object.values(conditions).flat().every((c) => typeof c.inputTokens === "number" && typeof c.outputTokens === "number"), aiSdkUsageBasis: Object.values(conditions).flat().every((c) => c.usageBasis === "ai_sdk_step_usage"), recipeReuseHappened: conditions.C.every((c) => c.recipesUsed?.length), secretsPrinted: false } };
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, outPath, model, averages, attribution, checks: artifact.checks }, null, 2));
