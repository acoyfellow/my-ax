#!/usr/bin/env node
// Fail CI if the public engine contains deployment-specific identity, hosts,
// account ids, credentials, or private environment files. Keep private values
// in a deployment wrapper; never add exceptions here for convenience.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findLeaksInText } from "./public-leak-rules.mjs";

const args = process.argv.slice(2);
const staged = args.includes("--staged");
const root = args.find((arg) => arg !== "--staged") || process.cwd();
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString("utf8").split("\0").filter(Boolean);
const stagedFiles = staged
  ? new Set(execFileSync("git", ["diff", "--cached", "--name-only", "-z"], { cwd: root }).toString("utf8").split("\0").filter(Boolean))
  : new Set();
const readTrackedFile = (file) => staged && stagedFiles.has(file)
  ? execFileSync("git", ["show", `:${file}`], { cwd: root, encoding: "utf8" })
  : readFileSync(`${root}/${file}`, "utf8");

const forbiddenNames = /(^|\/)(\.env|\.dev\.vars|employee\.env)(\.|$)/i;
const allowedExamples = new Set([".dev.vars.example", ".env.example"]);
const findings = [];

for (const file of tracked) {
  if (forbiddenNames.test(file) && !allowedExamples.has(file)) findings.push(`${file}: forbidden private environment filename`);
  let text;
  try { text = readTrackedFile(file); } catch { continue; }
  findings.push(...findLeaksInText(file, text));
}

// Public Wrangler config must never carry account-scoped resource ids.
const wrangler = readTrackedFile("wrangler.jsonc");
if (!wrangler.includes('"database_id": "REPLACE_WITH_D1_DATABASE_ID"')) findings.push("wrangler.jsonc: D1 database id must remain a placeholder");
if (!wrangler.includes('"id": "REPLACE_WITH_KV_NAMESPACE_ID"')) findings.push("wrangler.jsonc: KV namespace id must remain a placeholder");

if (findings.length) {
  console.error("Public-clean verification failed:\n" + findings.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`✓ public-clean: ${tracked.length} tracked files checked`);
