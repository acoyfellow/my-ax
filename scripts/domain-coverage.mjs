import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(root, "src/domain/coverage.json"), "utf8"));
const OWNED = new Set(["lifecycle", "record"]);

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

const migrationTables = new Set(
  readdirSync(join(root, "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .flatMap((name) => [...readFileSync(join(root, "migrations", name), "utf8").matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase()))
    .filter((table) => !table.endsWith("_next")),
);

const writes = new Map();
const writeRe = /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_]+)\b/gi;
for (const file of sourceFiles(join(root, "src"))) {
  const rel = file.slice(root.length);
  if (rel.startsWith("src/domain/")) continue;
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(writeRe)) {
    const table = match[1].toLowerCase();
    if (!migrationTables.has(table)) continue;
    if (!writes.has(table)) writes.set(table, new Set());
    writes.get(table).add(rel);
  }
}

const unknown = [...new Set([...writes.keys(), ...migrationTables])].filter((table) => !(table in manifest.tables)).sort();
const owned = Object.entries(manifest.tables).filter(([, entry]) => OWNED.has(entry.kind));
const covered = owned.filter(([, entry]) => entry.aggregate);
const gaps = owned.filter(([, entry]) => !entry.aggregate).map(([table]) => table);
const percent = Math.round((covered.length / owned.length) * 100);

const bypass = owned
  .map(([table]) => [table, [...(writes.get(table) ?? [])].sort()])
  .filter(([, files]) => files.length > 0);
const routed = owned.length - bypass.length;
const routedPercent = Math.round((routed / owned.length) * 100);
const strict = process.argv.includes("--strict");

const report = { covered: covered.length, owned: owned.length, percent, routed, routedPercent, gaps, unknownTables: unknown, bypass: Object.fromEntries(bypass) };
if (process.argv.includes("--json")) console.log(JSON.stringify(report));
else {
  console.log(`domain coverage: ${covered.length}/${owned.length} stateful tables have an aggregate (${percent}%), ${routed}/${owned.length} write only through src/domain (${routedPercent}%)`);
  if (gaps.length) console.log(`no aggregate: ${gaps.join(", ")}`);
  if (unknown.length) console.log(`written but not in src/domain/coverage.json: ${unknown.join(", ")}`);
  if (strict) for (const [table, files] of bypass) console.log(`bypass ${table}: ${files.join(", ")}`);
}
const ok = gaps.length === 0 && unknown.length === 0 && (!strict || bypass.length === 0);
process.exit(ok ? 0 : 1);
