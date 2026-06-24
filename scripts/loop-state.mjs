#!/usr/bin/env node
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = resolve(process.cwd());
const dir = join(root, ".my-ax-loop");
const statePath = join(dir, "state.json");
const lockPath = join(dir, "state.lock");
const states = new Set([
  "idle", "selecting", "child_running", "child_completed", "parent_review",
  "locally_verified", "queued_for_release", "deploying", "soaking", "proving",
  "production_certified", "complete", "retry_wait", "needs_operator",
  "rolling_back", "rollback_proving", "rolled_back",
]);
const transitions = new Map(Object.entries({
  idle: ["selecting", "needs_operator"],
  selecting: ["child_running", "complete", "retry_wait", "needs_operator"],
  child_running: ["child_completed", "retry_wait", "needs_operator"],
  child_completed: ["parent_review", "needs_operator"],
  parent_review: ["locally_verified", "retry_wait", "needs_operator", "rolled_back"],
  locally_verified: ["queued_for_release", "needs_operator", "rolled_back"],
  queued_for_release: ["deploying", "retry_wait", "needs_operator", "rolled_back"],
  deploying: ["soaking", "rolling_back", "retry_wait", "needs_operator"],
  soaking: ["proving", "rolling_back", "needs_operator"],
  proving: ["production_certified", "rolling_back", "retry_wait", "needs_operator"],
  production_certified: ["complete", "needs_operator"],
  retry_wait: ["selecting", "child_running", "parent_review", "queued_for_release", "deploying", "proving", "needs_operator"],
  needs_operator: ["selecting", "child_running", "parent_review", "queued_for_release", "deploying", "proving", "rolling_back", "rolled_back"],
  rolling_back: ["rollback_proving", "needs_operator"],
  rollback_proving: ["rolled_back", "needs_operator"],
  complete: [],
  rolled_back: [],
}));

function now() { return new Date().toISOString(); }
function today() { return now().slice(0, 10); }
function initialState() {
  const at = now();
  return {
    version: 1, generation: 1, fencingToken: 0, iterationId: null, findingId: null, weeklyBetId: null,
    userOutcome: null, releaseSummary: null,
    state: "idle", resumeState: null, stateEnteredAt: at, updatedAt: at,
    repository: { path: root, startRevision: null, baselineStatusHash: null, ownedFiles: [], patchDigest: null },
    lease: null, child: null, attempt: 0, notBefore: null, blocker: null,
    candidateRevision: null, deployment: null, proof: null, rollback: null,
    budget: { date: today(), searches: 0, writers: 0, deployments: 0, deploymentLimit: 1, browserProofs: 0 },
    circuit: { state: "closed", reason: null }, events: [],
  };
}
function validate(state) {
  if (!state || state.version !== 1) throw new Error("unsupported loop state version");
  if (!Number.isSafeInteger(state.generation) || state.generation < 1) throw new Error("invalid generation");
  if (!Number.isSafeInteger(state.fencingToken) || state.fencingToken < 0) throw new Error("invalid fencingToken");
  if (!states.has(state.state)) throw new Error(`invalid state: ${state.state}`);
  if (state.resumeState != null && !states.has(state.resumeState)) throw new Error("invalid resumeState");
  if (!state.repository || state.repository.path !== root) throw new Error("state belongs to another repository");
  if (!state.budget || typeof state.budget.date !== "string") throw new Error("invalid budget");
  if (!state.circuit || !["closed", "open"].includes(state.circuit.state)) throw new Error("invalid circuit");
  if (state.userOutcome != null) validateUserOutcome(state.userOutcome);
  if (state.releaseSummary != null) validateReleaseSummary(state.releaseSummary);
  if (state.lease) {
    if (!state.lease.id || !state.lease.holder || !Number.isSafeInteger(state.lease.fencingToken)) throw new Error("invalid lease");
    if (!Number.isFinite(Date.parse(state.lease.expiresAt))) throw new Error("invalid lease expiry");
  }
  return state;
}
async function readState() {
  const state = JSON.parse(await readFile(statePath, "utf8"));
  if (state.version === 1 && state.fencingToken == null) state.fencingToken = 0;
  if (state.version === 1 && !("userOutcome" in state)) state.userOutcome = null;
  if (state.version === 1 && !("releaseSummary" in state)) state.releaseSummary = null;
  return validate(state);
}
async function atomicWrite(state) {
  validate(state);
  await mkdir(dir, { recursive: true });
  const temp = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" });
  await rename(temp, statePath);
}
async function locked(fn) {
  await mkdir(dir, { recursive: true });
  let acquired = false;
  for (let attempt = 0; attempt < 2 && !acquired; attempt++) {
    try {
      await mkdir(lockPath);
      await writeFile(join(lockPath, "owner.json"), `${JSON.stringify({ pid: process.pid, createdAt: now() })}\n`);
      acquired = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let age = 0; try { age = Date.now() - (await stat(lockPath)).mtimeMs; } catch {}
      if (age < 30_000 || attempt > 0) throw new Error("loop state is locked by another controller");
      await rm(lockPath, { recursive: true, force: true });
    }
  }
  if (!acquired) throw new Error("could not acquire loop state lock");
  try { return await fn(); } finally { await rm(lockPath, { recursive: true, force: true }); }
}
function resetDailyBudget(state) {
  if (state.budget.date !== today()) state.budget = { date: today(), searches: 0, writers: 0, deployments: 0, deploymentLimit: 1, browserProofs: 0 };
  if (!Number.isSafeInteger(state.budget.deploymentLimit)) state.budget.deploymentLimit = 1;
}
function appendEvent(state, actor, reason, from, to) {
  const event = { generation: state.generation, at: now(), actor, reason, from, to };
  state.events = [...(state.events ?? []).slice(-49), event];
}
function requireGeneration(state, expected) {
  if (state.generation !== expected) throw new Error(`stale generation: expected ${expected}, current ${state.generation}`);
}
function text(value, label, max = 1000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`invalid ${label}`);
}
function validateUserOutcome(value) {
  if (!value || typeof value !== "object") throw new Error("invalid userOutcome");
  for (const key of ["user", "journey", "observedProblem", "expectedChange", "productionMeasure", "discovery"]) text(value[key], `userOutcome.${key}`);
  if (!["direct", "whats-new", "attention", "no-ui-needed"].includes(value.discovery)) throw new Error("invalid userOutcome.discovery");
}
function validateReleaseSummary(value) {
  if (!value || typeof value !== "object") throw new Error("invalid releaseSummary");
  for (const key of ["title", "benefit", "action", "visibility"]) text(value[key], `releaseSummary.${key}`);
  if (!["whats-new", "attention", "direct", "none"].includes(value.visibility)) throw new Error("invalid releaseSummary.visibility");
}
function requireLease(state) {
  if (!state.lease || Date.parse(state.lease.expiresAt) <= Date.now()) throw new Error("valid lease required");
}
function consumeBudget(state, to) {
  resetDailyBudget(state);
  const rules = { selecting: ["searches", 4], child_running: ["writers", 3], deploying: ["deployments", state.budget.deploymentLimit ?? 1] };
  const rule = rules[to]; if (!rule) return;
  const [field, limit] = rule;
  if ((state.budget[field] ?? 0) >= limit) throw new Error(`${field} daily budget exhausted`);
  state.budget[field] = (state.budget[field] ?? 0) + 1;
}

const [command = "status", ...args] = process.argv.slice(2);
try {
  if (command === "init") {
    await mkdir(dir, { recursive: true });
    try { await readFile(statePath); throw new Error("loop state already exists"); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    const state = initialState(); await atomicWrite(state); console.log(JSON.stringify(state, null, 2));
  } else if (command === "status" || command === "validate") {
    const state = await readState();
    console.log(command === "validate" ? `valid generation=${state.generation} state=${state.state}` : JSON.stringify(state, null, 2));
  } else if (command === "acquire") {
    const [holder, purpose = "reconcile", ttlRaw = "900"] = args;
    if (!holder) throw new Error("usage: acquire <holder> <purpose> [ttlSeconds]");
    const ttl = Number(ttlRaw); if (!Number.isFinite(ttl) || ttl < 30 || ttl > 3600) throw new Error("ttlSeconds must be 30..3600");
    await locked(async () => {
      const state = await readState(); resetDailyBudget(state);
      const currentExpiry = state.lease ? Date.parse(state.lease.expiresAt) : 0;
      if (state.lease && currentExpiry > Date.now() && state.lease.holder !== holder) throw new Error(`lease held by ${state.lease.holder}`);
      const token = state.fencingToken + 1;
      const at = now(); state.generation++; state.fencingToken = token;
      state.lease = { id: randomUUID(), holder, purpose, fencingToken: token, acquiredAt: at, heartbeatAt: at, expiresAt: new Date(Date.now() + ttl * 1000).toISOString() };
      state.updatedAt = at; appendEvent(state, holder, `lease:${purpose}`, state.state, state.state); await atomicWrite(state);
      console.log(JSON.stringify(state.lease));
    });
  } else if (command === "heartbeat") {
    const [holder, leaseId, ttlRaw = "900"] = args; const ttl = Number(ttlRaw);
    if (!holder || !leaseId || !Number.isFinite(ttl) || ttl < 30 || ttl > 3600) throw new Error("usage: heartbeat <holder> <leaseId> [ttlSeconds]");
    await locked(async () => {
      const state = await readState();
      if (!state.lease || state.lease.holder !== holder || state.lease.id !== leaseId) throw new Error("lease identity mismatch");
      if (Date.parse(state.lease.expiresAt) <= Date.now()) throw new Error("lease already expired");
      const at = now(); state.generation++; state.lease.heartbeatAt = at; state.lease.expiresAt = new Date(Date.now() + ttl * 1000).toISOString(); state.updatedAt = at;
      appendEvent(state, holder, "lease:heartbeat", state.state, state.state); await atomicWrite(state); console.log(JSON.stringify(state.lease));
    });
  } else if (command === "release") {
    const [holder, leaseId] = args; if (!holder || !leaseId) throw new Error("usage: release <holder> <leaseId>");
    await locked(async () => {
      const state = await readState(); if (!state.lease || state.lease.holder !== holder || state.lease.id !== leaseId) throw new Error("lease is not held by caller");
      const from = state.state; state.generation++; state.lease = null; state.updatedAt = now(); appendEvent(state, holder, "lease:release", from, from); await atomicWrite(state);
      console.log("released");
    });
  } else if (command === "transition") {
    const [generationRaw, from, to, reason = "controller transition", actor = "controller"] = args;
    const expected = Number(generationRaw);
    if (!Number.isSafeInteger(expected) || !states.has(from) || !states.has(to)) throw new Error("usage: transition <expectedGeneration> <fromState> <toState> [reason] [actor]");
    await locked(async () => {
      const state = await readState();
      requireGeneration(state, expected);
      if (state.state !== from) throw new Error(`state mismatch: expected ${from}, current ${state.state}`);
      if (!transitions.get(from)?.includes(to)) throw new Error(`illegal transition: ${from} -> ${to}`);
      requireLease(state);
      if (to === "child_running" && !state.userOutcome) throw new Error("user outcome gate must pass before writer launch");
      if (to === "production_certified" && !state.proof) throw new Error("production proof record required before certification");
      if (to === "complete" && from === "production_certified" && !state.releaseSummary) throw new Error("user-facing release summary required before completion");
      consumeBudget(state, to);
      const at = now(); state.generation++; state.state = to; state.stateEnteredAt = at; state.updatedAt = at;
      if (to === "selecting" && !state.iterationId) state.iterationId = randomUUID();
      appendEvent(state, actor, reason, from, to); await atomicWrite(state); console.log(JSON.stringify({ generation: state.generation, state: to }));
    });
  } else if (command === "set-outcome") {
    const [generationRaw, json, actor = "controller"] = args; const expected = Number(generationRaw);
    if (!Number.isSafeInteger(expected) || !json) throw new Error("usage: set-outcome <expectedGeneration> <json> [actor]");
    const outcome = JSON.parse(json); validateUserOutcome(outcome);
    await locked(async () => {
      const state = await readState(); requireGeneration(state, expected); requireLease(state);
      if (state.state !== "selecting") throw new Error("user outcome can only be frozen while selecting");
      const from = state.state; state.generation++; state.userOutcome = outcome; state.findingId = outcome.findingId ?? state.findingId; state.updatedAt = now(); appendEvent(state, actor, `user-outcome:${outcome.journey}`, from, from); await atomicWrite(state);
      console.log(JSON.stringify({ generation: state.generation, userOutcome: outcome }));
    });
  } else if (command === "set-release-summary") {
    const [generationRaw, json, actor = "controller"] = args; const expected = Number(generationRaw);
    if (!Number.isSafeInteger(expected) || !json) throw new Error("usage: set-release-summary <expectedGeneration> <json> [actor]");
    const summary = JSON.parse(json); validateReleaseSummary(summary);
    await locked(async () => {
      const state = await readState(); requireGeneration(state, expected); requireLease(state);
      if (!["proving", "production_certified"].includes(state.state)) throw new Error("release summary can only be set after deployment proof begins");
      const from = state.state; state.generation++; state.releaseSummary = summary; state.updatedAt = now(); appendEvent(state, actor, `release-summary:${summary.title}`, from, from); await atomicWrite(state);
      console.log(JSON.stringify({ generation: state.generation, releaseSummary: summary }));
    });
  } else if (command === "set-proof") {
    const [generationRaw, json, actor = "controller"] = args; const expected = Number(generationRaw);
    if (!Number.isSafeInteger(expected) || !json) throw new Error("usage: set-proof <expectedGeneration> <json> [actor]");
    const proof = JSON.parse(json); text(proof.deploymentRevision, "proof.deploymentRevision"); text(proof.measure, "proof.measure"); text(proof.result, "proof.result");
    await locked(async () => {
      const state = await readState(); requireGeneration(state, expected); requireLease(state);
      if (state.state !== "proving") throw new Error("proof can only be recorded while proving");
      const from = state.state; state.generation++; state.proof = proof; state.updatedAt = now(); appendEvent(state, actor, `proof:${proof.result}`, from, from); await atomicWrite(state);
      console.log(JSON.stringify({ generation: state.generation, proof }));
    });
  } else if (command === "set-bet") {
    const [generationRaw, betId, actor = "controller"] = args; const expected = Number(generationRaw);
    if (!Number.isSafeInteger(expected) || !/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(betId ?? "")) throw new Error("usage: set-bet <expectedGeneration> <betId> [actor]");
    await locked(async () => {
      const state = await readState(); requireGeneration(state, expected); requireLease(state);
      const from = state.state; state.generation++; state.weeklyBetId = betId; state.updatedAt = now(); appendEvent(state, actor, `weekly-bet:${betId}`, from, from); await atomicWrite(state);
      console.log(JSON.stringify({ generation: state.generation, weeklyBetId: betId }));
    });
  } else if (command === "circuit") {
    const [generationRaw, value, reason = null, actor = "controller"] = args; const expected = Number(generationRaw);
    if (!Number.isSafeInteger(expected) || !["open", "closed"].includes(value)) throw new Error("usage: circuit <expectedGeneration> <open|closed> [reason] [actor]");
    await locked(async () => {
      const state = await readState(); requireGeneration(state, expected); requireLease(state);
      const from = state.state; state.generation++; state.circuit = { state: value, reason: value === "open" ? (reason ?? "operator opened circuit") : null }; state.updatedAt = now(); appendEvent(state, actor, `circuit:${value}`, from, from); await atomicWrite(state);
      console.log(JSON.stringify({ generation: state.generation, circuit: state.circuit }));
    });
  } else if (command === "approve-release") {
    const [generationRaw, limitRaw = "2", reason = "explicit operator approval", actor = "operator"] = args;
    const expected = Number(generationRaw), limit = Number(limitRaw);
    if (!Number.isSafeInteger(expected) || !Number.isSafeInteger(limit) || limit < 2 || limit > 2) throw new Error("usage: approve-release <expectedGeneration> 2 [reason] [actor]");
    await locked(async () => {
      const state = await readState(); requireGeneration(state, expected); requireLease(state); resetDailyBudget(state);
      const from = state.state; state.generation++; state.budget.deploymentLimit = 2; state.updatedAt = now(); appendEvent(state, actor, `release-budget:2:${reason}`, from, from); await atomicWrite(state);
      console.log(JSON.stringify({ generation: state.generation, deploymentLimit: 2 }));
    });
  } else if (command === "archive") {
    const [generationRaw, actor = "controller"] = args; const expected = Number(generationRaw);
    if (!Number.isSafeInteger(expected)) throw new Error("usage: archive <expectedGeneration> [actor]");
    await locked(async () => {
      const state = await readState(); requireGeneration(state, expected); requireLease(state);
      if (!["complete", "rolled_back"].includes(state.state)) throw new Error("only terminal iterations can be archived");
      const from = state.state; const at = now(); state.generation++; state.state = "idle"; state.stateEnteredAt = at; state.updatedAt = at;
      for (const key of ["iterationId", "findingId", "userOutcome", "releaseSummary", "resumeState", "child", "blocker", "candidateRevision", "deployment", "proof", "rollback", "notBefore"]) state[key] = null;
      state.attempt = 0; state.repository = { path: root, startRevision: null, baselineStatusHash: null, ownedFiles: [], patchDigest: null };
      appendEvent(state, actor, "archive terminal iteration", from, "idle"); await atomicWrite(state); console.log(JSON.stringify({ generation: state.generation, state: "idle" }));
    });
  } else if (command === "fingerprint") {
    const data = await readFile(args[0] ?? statePath); console.log(createHash("sha256").update(data).digest("hex"));
  } else throw new Error(`unknown command: ${command}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
