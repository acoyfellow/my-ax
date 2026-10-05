import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const TEST_FILE_PATTERN = /\.test\.(ts|mjs|js|tsx)$/;

export const ALLOWLIST = new Map([
  [
    "src/ui/chat-user-whitespace.test.ts",
    "Asserts a msg-user-content wrapper and trimmed composer text that Chat.svelte does not implement; needs a product decision before it can run.",
  ],
]);

const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git", ".wrangler", "dist"]);

export function reachableScripts(scripts, entry) {
  const seen = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const name = pending.pop();
    if (seen.has(name) || scripts[name] === undefined) continue;
    seen.add(name);
    for (const match of scripts[name].matchAll(/npm run ([\w:.-]+)/g)) pending.push(match[1]);
  }
  return seen;
}

export function reachedTestFiles(scripts, entry) {
  const files = new Set();
  for (const name of reachableScripts(scripts, entry)) {
    for (const token of scripts[name].split(/\s+/)) {
      const cleaned = token.replace(/^\.\//, "");
      if (TEST_FILE_PATTERN.test(cleaned)) files.add(cleaned);
    }
  }
  return files;
}

export function listTestFiles(root, directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listTestFiles(root, path));
    else if (TEST_FILE_PATTERN.test(entry.name)) files.push(relative(root, path).split("\\").join("/"));
  }
  return files.sort();
}

export function findOrphans(root, entry = "check", allowlist = ALLOWLIST) {
  const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;
  const reached = reachedTestFiles(scripts, entry);
  return listTestFiles(root).filter((file) => !reached.has(file) && !allowlist.has(file));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const orphans = findOrphans(root);
  if (orphans.length > 0) {
    console.error(`Test files not reached from npm run check:\n${orphans.join("\n")}`);
    process.exit(1);
  }
  console.log("test inventory: every test file is reached from check");
}
