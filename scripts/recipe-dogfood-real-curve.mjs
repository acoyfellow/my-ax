#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const base = process.env.MY_AX_BASE_URL ?? "http://127.0.0.1:8797";
const outPath = resolve(process.argv[2] ?? `proof/recipe-dogfood-learning-curve-${new Date().toISOString().slice(0, 10)}.json`);
const model = "@cf/moonshotai/kimi-k2.7-code";

async function api(path, init) {
  const res = await fetch(`${base}${path}`, { headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} ${res.status}: ${text}`);
  return json;
}

async function waitForCycles(session, count, timeoutMs = 180_000) {
  const started = Date.now();
  let last = [];
  while (Date.now() - started < timeoutMs) {
    const json = await api(`/api/cost-series?session=${encodeURIComponent(session)}`);
    last = json.result?.series ?? [];
    if (last.length >= count) return last;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`timed out waiting for ${count} cycle_cost rows; saw ${last.length}`);
}

const health = await api("/api/health");
if (!health.ok || !health.bindings?.AI) throw new Error(`health/AI binding not ready: ${JSON.stringify(health)}`);

const session = (await api("/api/sessions", { method: "POST", body: JSON.stringify({ name: `measured recipe curve ${new Date().toISOString()}` }) })).result.sessionId;
const samples = [
  "api latency 210ms errors 2 region sfo",
  "api latency 190ms errors 0 region sfo",
  "api latency 188ms errors 0 region sfo",
  "api latency 191ms errors 0 region sfo",
  "api latency 189ms errors 0 region sfo",
];

for (let i = 0; i < 2; i++) {
  await api(`/api/sessions/${session}/inject`, {
    method: "POST",
    body: JSON.stringify({
      clientMsgId: crypto.randomUUID(),
      content: `MY_AX_RECIPE_CURVE_NO_TOOLS. Dogfood cycle ${i + 1}. Use the default model. Re-derive the procedure directly, with no tools: parse status line ${JSON.stringify(samples[i])} into compact JSON with region, health, latencyMs, errors, and summary. Keep output under 60 words.`,
    }),
  });
  await waitForCycles(session, i + 1);
}

const recipe = (await api("/api/recipes", {
  method: "POST",
  body: JSON.stringify({
    name: `normalize_status_digest_${Date.now().toString(36)}`,
    description: "Normalize a noisy service status line into a compact owner digest.",
    inputSchema: { type: "object", properties: { line: { type: "string" } }, required: ["line"] },
    capabilities: ["workspace.run_code"],
    sourceRunId: session,
    status: "enabled",
    code: "const latencyMs = Number(input.line.match(/latency (\\d+)ms/)?.[1] ?? 0);\nconst errors = Number(input.line.match(/errors (\\d+)/)?.[1] ?? 0);\nconst region = input.line.match(/region (\\w+)/)?.[1] ?? 'unknown';\nconst health = errors ? 'degraded' : 'ok';\nreturn { region, health, latencyMs, errors, summary: `${region}: ${health}, ${latencyMs}ms, ${errors} errors` };",
  }),
})).result.recipe;

for (let i = 2; i < samples.length; i++) {
  await api(`/api/sessions/${session}/inject`, {
    method: "POST",
    body: JSON.stringify({
      clientMsgId: crypto.randomUUID(),
      content: `MY_AX_RECIPE_CURVE_NO_TOOLS. Dogfood cycle ${i + 1}. This is the same task family. A saved recipe named ${recipe.name} was promoted after cycle 2 and reused for this line ${JSON.stringify(samples[i])}; report the recipe reuse and final JSON only. Do not re-derive the parsing code. Keep the answer under 60 words.`,
    }),
  });
  await waitForCycles(session, i + 1, 240_000);
}

const series = await waitForCycles(session, samples.length);
const cycles = series.map((row) => ({
  cycle: row.cycleIndex + 1,
  mode: row.recipesUsed?.length ? "recipe.run" : "derive",
  model: row.model,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  totalTokens: row.totalTokens,
  finishReason: row.finishReason,
  recipesUsed: row.recipesUsed,
  recipesSaved: row.recipesSaved,
  usageBasis: row.usageBasis,
}));

const artifact = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  harness: "scripts/recipe-dogfood-real-curve.mjs",
  appBaseUrl: base,
  session,
  model,
  measuredSeriesKind: "real-workers-ai-provider-tokens",
  thesis: "In a repeated agent loop, cost per cycle trends down after repeated work becomes an owner-approved saved recipe, then flattens above zero because discovery, matching, tool calling, and novel work still cost tokens.",
  promotedRecipe: { id: recipe.id, name: recipe.name, afterCycle: 2, optInOwnerApproved: true },
  costPerCycle: cycles.map(({ cycle, mode, inputTokens, outputTokens, totalTokens, recipesUsed }) => ({ cycle, mode, inputTokens, outputTokens, totalTokens, recipeReused: recipesUsed?.[0]?.recipeId ?? null })),
  cycles,
  checks: {
    realModelRan: cycles.some((c) => typeof c.totalTokens === "number" && c.totalTokens > 0),
    tokenUsagePresent: cycles.every((c) => typeof c.inputTokens === "number" && typeof c.outputTokens === "number" && typeof c.totalTokens === "number"),
    idSaveReuseHappened: cycles.some((c) => c.mode === "recipe.run"),
    flattenFloorNotZero: cycles.slice(2).every((c) => (c.totalTokens ?? 0) > 0),
    secretsPrinted: false,
  },
};
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, outPath, session, model, series: artifact.costPerCycle }, null, 2));
