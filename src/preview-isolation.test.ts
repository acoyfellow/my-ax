import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parse } from "jsonc-parser";

const root = join(import.meta.dirname, "..");
const script = join(root, "scripts", "verify-preview-isolation.mjs");
const configPath = join(root, "wrangler.jsonc");

function run(...environments: string[]): { code: number; out: string } {
  try {
    const out = execFileSync("node", [script, ...environments], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

function liveConfig(): Record<string, any> {
  return parse(readFileSync(configPath, "utf8"), [], { allowTrailingComma: true });
}

test("every non-production environment owns its data", () => {
  const result = run();
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /own their data/);
});

test("a preview environment that reuses a production bucket is refused", () => {
  const original = readFileSync(configPath, "utf8");
  try {
    writeFileSync(configPath, original.replace('"bucket_name": "my-ax-homes-preview"', '"bucket_name": "my-ax-homes"'));
    const result = run("preview");
    assert.equal(result.code, 1, "binding a production bucket must fail the check");
    assert.match(result.out, /production bucket my-ax-homes/);
  } finally {
    writeFileSync(configPath, original);
  }
});

test("a preview environment that reuses the production database is refused", () => {
  const original = readFileSync(configPath, "utf8");
  try {
    writeFileSync(configPath, original.replace('"database_name": "my-ax-db-preview"', '"database_name": "my-ax-db"'));
    const result = run("preview");
    assert.equal(result.code, 1, "binding the production database must fail the check");
    assert.match(result.out, /production database my-ax-db/);
  } finally {
    writeFileSync(configPath, original);
  }
});

test("the preview environment exists and every data binding is preview scoped", () => {
  const preview = liveConfig().env?.preview;
  assert.ok(preview, "env.preview must exist for per-PR staging deploys");
  for (const bucket of preview.r2_buckets ?? []) assert.match(bucket.bucket_name, /-preview$/);
  for (const database of preview.d1_databases ?? []) assert.match(database.database_name, /-preview$/);
});

test("the preview environment cannot reach the production sandbox", () => {
  const preview = liveConfig().env?.preview;
  for (const container of preview.containers ?? []) {
    assert.notEqual(container.name, "my-ax-sandbox", "a preview must not run the production sandbox");
  }
  const bindings = (preview.durable_objects?.bindings ?? []).map((binding: { name: string }) => binding.name);
  assert.ok(!bindings.includes("SANDBOX"), "a preview must not bind the production sandbox durable object");
});
