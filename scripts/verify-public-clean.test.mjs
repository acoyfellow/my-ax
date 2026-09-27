import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const guard = joinPath(dirname(fileURLToPath(import.meta.url)), "verify-public-clean.mjs");
const part = (...pieces) => pieces.join("");

function scanRepo(files) {
  const root = mkdtempSync(joinPath(tmpdir(), "public-clean-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: root });
    const all = {
      "wrangler.jsonc": '{ "database_id": "REPLACE_WITH_D1_DATABASE_ID", "id": "REPLACE_WITH_KV_NAMESPACE_ID" }',
      ...files,
    };
    for (const [path, text] of Object.entries(all)) {
      mkdirSync(dirname(joinPath(root, path)), { recursive: true });
      writeFileSync(joinPath(root, path), text);
    }
    execFileSync("git", ["add", "-A"], { cwd: root });
    try {
      execFileSync("node", [guard, root], { stdio: "pipe" });
      return { ok: true, output: "" };
    } catch (error) {
      return { ok: false, output: String(error.stderr) };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("an internal GitLab host fails the guard", () => {
  const result = scanRepo({ "src/a.ts": `const u = "https://${part("gitlab.", "cf", "data", ".org")}/g/p";` });
  assert.equal(result.ok, false);
  assert.match(result.output, /private host/);
});

test("any subdomain of the private dev zone fails, not only a fixed list", () => {
  const result = scanRepo({ "docs/x.md": `webhook: https://${part("hooks.ax", ".cloudflare", ".dev")}/github` });
  assert.equal(result.ok, false);
  assert.match(result.output, /private host/);
});

test("the private account id fails without appearing in this test", () => {
  const id = ["31b91e7f", "9954ad8a", "a334d46f", "012bd8ed"].join("");
  const result = scanRepo({ "src/b.ts": `const account = "${id}";` });
  assert.equal(result.ok, false);
  assert.match(result.output, /private account id/);
});

test("example hosts and generic Access team placeholders pass", () => {
  const result = scanRepo({
    "src/c.ts": 'const u = "https://gitlab.example.com/g/p"; const iss = "https://your-team.cloudflareaccess.com";',
  });
  assert.equal(result.ok, true, result.output);
});
