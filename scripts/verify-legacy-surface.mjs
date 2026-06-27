#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const roots = ["src", "proof", "public", "docs", "README.md", "CHANGELOG.md", "package.json"];
const ignoredDirs = new Set(["node_modules", ".git", ".wrangler"]);
const binaryExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".woff", ".woff2"]);
const legacyPatterns = [
  /\/api\/hammers\b/i,
  /\bhammer\.list\b/i,
  /\bhammer\.run\b/i,
  /\bSavedHammer\b/,
  /\brunSavedHammer\b/,
  /\blistSavedHammers\b/,
  /\bsaved hammers\b/i,
  /\bSaved hammers\b/,
  /\bHammers\b/,
];

function walk(path) {
  const st = statSync(path);
  if (st.isDirectory()) {
    const name = path.split(/[\\/]/).pop();
    if (ignoredDirs.has(name)) return [];
    return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
  }
  return [path];
}

function ext(path) {
  const match = /\.[^.]+$/.exec(path);
  return match?.[0].toLowerCase() ?? "";
}

const files = roots.flatMap((entry) => walk(join(root, entry))).filter((file) => !binaryExts.has(ext(file)));
const failures = [];
for (const file of files) {
  let text;
  try { text = readFileSync(file, "utf8"); }
  catch { continue; }
  for (const pattern of legacyPatterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const before = text.slice(0, match.index);
    const line = before.split("\n").length;
    failures.push(`${relative(root, file)}:${line}: ${pattern} -> ${match[0]}`);
  }
}

if (failures.length) {
  console.error("Legacy saved-hammer surface leaked into user/agent-facing files:");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("Historical migration files may mention the old storage name, but runtime/UI/API/docs must say Recipes.");
  process.exit(1);
}

console.log(`✓ legacy-surface: ${files.length} files checked; Recipes surface is clean`);
