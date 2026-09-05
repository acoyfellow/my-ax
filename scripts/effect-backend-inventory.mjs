import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const inventoryPath = resolve(root, "docs/effect-backend-inventory.json");
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "src", "agents", "proof", "scripts"], { cwd: root })
  .toString()
  .split("\0")
  .filter(Boolean)
  .filter((path) => /\.(?:ts|tsx|mjs|cjs|sh|json|md)$/.test(path))
  .sort();

const staticEvidenceFiles = new Set([
  "scripts/cloudflare-workers-test-stub.cjs",
  "scripts/test-public-url.mjs",
  "scripts/test-run-receipts.mjs",
  "scripts/test-session-entries.mjs",
]);

const frontendGeneratedFiles = new Set([
  "src/artifact-runtime.ts",
]);

const runtimeBoundaries = new Set([
  "src/index.tsx",
  "src/agent-stub.ts",
  "src/auth.ts",
  "src/code-mode-runtime.worker.ts",
  "src/computer-workspace.ts",
  "src/code-mode-runtime.ts",
  "src/dead-session.ts",
  "src/gateway-retry-fetch.ts",
  "src/oauth-store.ts",
  "src/pantry-client.ts",
  "src/run-receipts.ts",
  "src/think-workspace.ts",
  "src/user-agent.ts",
  "src/voice-check-prompt.ts",
  "src/web-search.ts",
  "src/workspace-read.ts",
  "agents/src/hook.ts",
  "agents/src/ports.ts",
  "agents/src/worker.ts",
  "agents/src/workflow-entry.ts",
  "proof/plan.ts",
  "proof/terminal-gh-probe.mjs",
  "proof/terminal-live-client.mjs",
  "proof/terminal-upgrade-probe.mjs",
]);

const pureFiles = new Set([
  "agents/src/github-hmac.ts",
  "agents/src/policy.ts",
  "agents/src/preview-check.ts",
  "agents/src/public-text.ts",
  "agents/src/sweep.ts",
  "src/app-env.ts",
  "src/artifact-theme.ts",
  "src/attachment-alignment.ts",
  "src/attachment-reference.ts",
  "src/auto-trust.ts",
  "src/bridge-origin.ts",
  "src/capability-intersect.ts",
  "src/capability-review.ts",
  "src/client-snapshot.ts",
  "src/code-diff-read.ts",
  "src/code-diff.ts",
  "src/compaction-summary.ts",
  "src/computer-owner.ts",
  "src/computer-retained-write-budget.ts",
  "src/computer-work-budget.ts",
  "src/connectors.ts",
  "src/delegate-many.ts",
  "src/delegate-receipt.ts",
  "src/delegate-serial.ts",
  "src/delegation-fabric.ts",
  "src/deploy-version.ts",
  "src/desk-board.ts",
  "src/error-meta.ts",
  "src/error-report.ts",
  "src/fractional-index.ts",
  "src/job-state-transition.ts",
  "src/machinectl-output.ts",
  "src/mcp-code-mode-policy.ts",
  "src/memory-block.ts",
  "src/model-auth.ts",
  "src/model-message-urls.ts",
  "src/model-tool-output-limit.ts",
  "src/models.ts",
  "src/public-url.ts",
  "src/recipe-approval-policy.ts",
  "src/recipe-usage-collector.ts",
  "src/recovery-exhaustion-contract.ts",
  "src/recovery-exhaustion.ts",
  "src/recurring-job-receipt.ts",
  "src/reusable-tool-candidate.ts",
  "src/sequence-integrity.ts",
  "src/session-ownership.ts",
  "src/show-diff.ts",
  "src/source-href.ts",
  "src/suggest-recipe-name.ts",
  "src/terminal-protocol.ts",
  "src/tool-arguments.ts",
  "src/tool-id-sanitize.ts",
  "src/tool-output-limit.ts",
  "src/turn-visible-receipt.ts",
  "src/types.ts",
  "src/upstream-rate-limit.ts",
  "src/voice-docs-tool.ts",
  "src/voice-narration.ts",
  "src/voice-session-ownership.ts",
  "src/voice-think-config.ts",
  "src/work-code-output.ts",
  "src/workspace-path.ts",
]);

const buildScripts = new Set([
  "scripts/build-brand.mjs",
  "scripts/build-docs.mjs",
  "scripts/build-vendor.mjs",
  "scripts/cloudflare-test-loader-hooks.mjs",
  "scripts/cloudflare-test-loader.mjs",
  "scripts/loop-disagree.mjs",
  "scripts/loop-disagree.test.mjs",
  "scripts/native-proxy/build.sh",
  "scripts/setup.sh",
  "scripts/verify-deployable-config.mjs",
  "scripts/verify-legacy-surface.mjs",
  "scripts/verify-preview-isolation.mjs",
  "scripts/verify-public-clean.mjs",
  "scripts/effect-backend-inventory.mjs",
]);

const sideEffectPattern = /\b(?:fetch|setTimeout|setInterval)\s*\(|\bnew\s+Promise\b|\bPromise\.(?:all|race|allSettled)\s*\(|\.prepare\s*\(|\.exec\s*\(|\.startProcess\s*\(|\.runCode\s*\(|\bcrypto\.subtle\b|\bWorkflowEntrypoint\b|\bDurableObject\b/;

function classify(path, source) {
  if (staticEvidenceFiles.has(path) || /\.test\.(?:ts|mjs|cjs)$/.test(path) || /(?:^|\/)fixtures?(?:\/|$)/.test(path)) return ["static-evidence", "test or fixture"];
  if (frontendGeneratedFiles.has(path) || /^(?:src\/ui\/|src\/views\/|src\/styles\/)/.test(path) || /(?:generated|\.svelte)/.test(path)) return ["frontend-generated", "frontend or generated"];
  if (/\.(?:md|json)$/.test(path) || /wrangler(?:\.hook)?\.jsonc$/.test(path)) return ["static-evidence", "documentation, configuration, or receipt"];
  if (path.startsWith("src/routes/") || runtimeBoundaries.has(path)) return ["runtime-adapter", "Cloudflare or HTTP runtime edge"];
  if (pureFiles.has(path) || buildScripts.has(path)) return ["plain-typescript", "reviewed pure or build-time module"];
  if (path.startsWith("proof/")) return ["effect-program", "active live proof workflow"];
  if (path.startsWith("scripts/") && /(?:deploy|dev-access|proxy|prove|trigger|test-|recipe-)/.test(path)) return ["effect-program", "operational workflow"];
  if (/from\s+["']effect["']/.test(source)) return ["effect-program", "Effect workflow"];
  if (sideEffectPattern.test(source) || /\basync\s+(?:function|\w+\s*\()/.test(source)) return ["effect-program", "external, concurrent, timed, or fallible workflow"];
  return ["plain-typescript", "no managed side effects detected"];
}

const entries = files.map((path) => {
  const source = readFileSync(resolve(root, path), "utf8");
  const [classification, reason] = classify(path, source);
  const usesEffect = /from\s+["']effect["']/.test(source);
  const nestedRuntime = /Effect\.run(?:Promise|PromiseExit|Sync|SyncExit)\s*\(/.test(source) && !runtimeBoundaries.has(path) && !path.startsWith("src/routes/");
  const status = classification === "effect-program"
    ? usesEffect && !nestedRuntime ? "migrated" : "pending"
    : "accepted";
  return { path, classification, status, reason };
});

const summary = entries.reduce((result, entry) => {
  result.total += 1;
  result.classifications[entry.classification] = (result.classifications[entry.classification] ?? 0) + 1;
  result.statuses[entry.status] = (result.statuses[entry.status] ?? 0) + 1;
  return result;
}, { total: 0, classifications: {}, statuses: {} });

const inventory = { version: 1, generatedBy: relative(root, import.meta.filename), summary, entries };
const serialized = `${JSON.stringify(inventory, null, 2)}\n`;

if (process.argv.includes("--write")) {
  writeFileSync(inventoryPath, serialized);
  console.log(`effect-backend-inventory=written total=${summary.total} pending=${summary.statuses.pending ?? 0}`);
} else {
  const current = readFileSync(inventoryPath, "utf8");
  if (current !== serialized) {
    console.error("effect-backend-inventory=stale");
    process.exit(1);
  }
  const pending = entries.filter((entry) => entry.status === "pending");
  if (pending.length > 0) {
    for (const entry of pending) console.error(`pending ${entry.path}`);
    console.error(`effect-backend-inventory=fail pending=${pending.length}`);
    process.exit(1);
  }
  console.log(`effect-backend-inventory=pass total=${summary.total}`);
}
