import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const inventory = JSON.parse(readFileSync(resolve(root, "docs/effect-backend-inventory.json"), "utf8"));
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const failures = [];

if (pkg.dependencies?.effect !== "4.0.0-rc.112") {
  failures.push(`effect must be pinned to 4.0.0-rc.112, got ${pkg.dependencies?.effect ?? "missing"}`);
}

for (const entry of inventory.entries) {
  const source = readFileSync(resolve(root, entry.path), "utf8");
  if (entry.classification === "frontend-generated" && /from\s+["']effect["']/.test(source)) {
    failures.push(`${entry.path}: frontend and generated files must not import Effect`);
  }
  if (/concurrency\s*:\s*["']unbounded["']/.test(source)) {
    failures.push(`${entry.path}: unbounded concurrency is forbidden`);
  }
  if (/Effect\.(?:catchAll)|Schedule\.(?:intersect|whileInput)/.test(source)) {
    failures.push(`${entry.path}: removed Effect v3 API`);
  }
  if (/Effect\.run(?:Promise|PromiseExit|Sync|SyncExit)\s*\(/.test(source)
    && entry.classification !== "runtime-adapter"
    && entry.classification !== "static-evidence") {
    failures.push(`${entry.path}: Effect runtime execution is allowed only at adapters and tests`);
  }
  if (entry.status === "migrated") {
    if (/export\s+async\s+function/.test(source)) failures.push(`${entry.path}: migrated programs must export Effects, not Promises`);
    if (/\bnew\s+Promise\b|\bPromise\.(?:all|race|allSettled)\s*\(|\bset(?:Timeout|Interval)\s*\(/.test(source)) {
      failures.push(`${entry.path}: migrated programs contain unmanaged async orchestration`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`effect-architecture: ${failure}`);
  process.exit(1);
}

console.log(`effect-architecture=pass files=${inventory.summary.total}`);
