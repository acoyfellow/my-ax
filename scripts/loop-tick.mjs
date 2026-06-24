#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function classifyTick({ state, dirty, diffDigest, now = new Date() }) {
  if (state.circuit?.state === "open") return { action: "circuit_open", mutate: false, reason: state.circuit.reason ?? "circuit is open" };
  if (state.lease && Date.parse(state.lease.expiresAt) > now.getTime()) return { action: "wait_for_lease", mutate: false, reason: `lease held by ${state.lease.holder}` };
  if (dirty) {
    if (state.repository?.patchDigest && state.repository.patchDigest === diffDigest && ["child_completed", "parent_review", "locally_verified"].includes(state.state)) {
      return { action: "reconcile_current", mutate: false, reason: "checkout matches iteration-owned patch" };
    }
    return { action: "needs_operator_dirty_checkout", mutate: false, reason: "checkout differs from recorded controller ownership" };
  }
  if (!["idle", "complete", "rolled_back"].includes(state.state)) return { action: "reconcile_current", mutate: false, reason: `advance nonterminal state ${state.state}` };
  if (state.state !== "idle") return { action: "archive_terminal", mutate: false, reason: `archive terminal iteration in state ${state.state}` };
  if (!state.weeklyBetId) return { action: "needs_direction", mutate: false, reason: "no current weekly bet" };
  const budget = state.budget ?? {};
  if ((budget.searches ?? 0) >= 4 || (budget.writers ?? 0) >= 3 || (budget.deployments ?? 0) >= 1) {
    return { action: "budget_exhausted", mutate: false, reason: "daily search/writer/release budget reached" };
  }
  return { action: "eligible_to_select", mutate: false, reason: "idle, directed, clean, circuit closed, and within budget" };
}

async function checkoutPatchDigest(root) {
  const hash = createHash("sha256");
  hash.update(execFileSync("git", ["diff", "--binary", "HEAD", "--"], { cwd: root }));
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root })
    .toString("utf8").split("\0").filter(Boolean).sort();
  for (const file of untracked) { hash.update(`\0${file}\0`); hash.update(await readFile(resolve(root, file))); }
  return hash.digest("hex");
}

async function main() {
  const root = resolve(process.cwd());
  const state = JSON.parse(await readFile(`${root}/.my-ax-loop/state.json`, "utf8"));
  const porcelain = execFileSync("git", ["status", "--porcelain=v2", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  const diffDigest = await checkoutPatchDigest(root);
  const result = classifyTick({ state, dirty: porcelain.trim().length > 0, diffDigest });
  console.log(JSON.stringify({ ...result, state: state.state, generation: state.generation, diffDigest }, null, 2));
  if (result.action.startsWith("needs_operator") || result.action === "circuit_open") process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await main();
