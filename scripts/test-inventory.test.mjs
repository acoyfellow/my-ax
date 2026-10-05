import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findOrphans, reachedTestFiles } from "./test-inventory.mjs";

function fixture(scripts, files) {
  const root = mkdtempSync(join(tmpdir(), "test-inventory-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts }));
  for (const file of files) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), "");
  }
  return root;
}

test("follows npm run chains from check to collect test file arguments", () => {
  const scripts = {
    check: "npm run build && npm run test:unit",
    "test:unit": "npm run test:a && npm run test:b",
    "test:a": "tsx --test src/a.test.ts",
    "test:b": "node --test ./scripts/b.test.mjs",
    "test:unreached": "tsx --test src/c.test.ts",
  };
  assert.deepEqual([...reachedTestFiles(scripts, "check")].sort(), ["scripts/b.test.mjs", "src/a.test.ts"]);
});

test("reports test files that check never reaches", () => {
  const root = fixture(
    { check: "npm run test:a", "test:a": "tsx --test src/a.test.ts", "test:other": "tsx --test src/b.test.ts" },
    ["src/a.test.ts", "src/b.test.ts", "src/ui/c.test.tsx", "node_modules/x/d.test.js"],
  );
  assert.deepEqual(findOrphans(root, "check", new Map()), ["src/b.test.ts", "src/ui/c.test.tsx"]);
  assert.deepEqual(findOrphans(root, "check", new Map([["src/b.test.ts", "reason"], ["src/ui/c.test.tsx", "reason"]])), []);
});

test("every test file in this repository is reached from check or allowlisted", () => {
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  assert.deepEqual(findOrphans(root), []);
});
