import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..");
const script = join(root, "scripts", "verify-deployable-config.mjs");
const configPath = join(root, "wrangler.jsonc");

function run(): { code: number; out: string } {
  try {
    const out = execFileSync("node", [script], { encoding: "utf8" });
    return { code: 0, out };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

test("the public config is refused, because deploying it would drop the domain", () => {
  const result = run();
  assert.equal(result.code, 1);
  assert.match(result.out, /routes is empty/);
  assert.match(result.out, /CF_ACCESS_AUD is empty/);
});

test("a real production config is accepted", () => {
  const original = readFileSync(configPath, "utf8");
  try {
    writeFileSync(
      configPath,
      original
        .replace('"routes": [],', '"routes": [{"pattern":"example.test","custom_domain":true}],')
        .replace('"CF_ACCESS_AUD": "",', '"CF_ACCESS_AUD": "aud-value",')
        .replace('"CF_ACCESS_ISS": "",', '"CF_ACCESS_ISS": "https://example.cloudflareaccess.com",'),
    );
    const result = run();
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /1 route\(s\) and Access vars are set/);
  } finally {
    writeFileSync(configPath, original);
  }
});
