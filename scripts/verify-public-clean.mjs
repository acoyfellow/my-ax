#!/usr/bin/env node
// Fail CI if the public engine contains deployment-specific identity, hosts,
// account ids, credentials, or private environment files. Keep private values
// in a deployment wrapper; never add exceptions here for convenience.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = process.argv[2] || process.cwd();
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root })
  .toString("utf8").split("\0").filter(Boolean);

const exactFragments = [
  ["my", "ax", "cloudflare", "dev"].join("."),
  ["support", "chat", "cloudflareaccess", "com"].join("."),
  ["mcp", "ax", "cloudflare", "dev"].join("."),
  ["open", "code", "cloudflare", "dev"].join("."),
  ["cf", "data", "org"].join("."),
  ["gitlab", "cf", "data", "org"].join("."),
  ["wiki", "cf", "data", "org"].join("."),
  ["jira", "cf", "data", "org"].join("."),
].map((value) => value.toLowerCase());
const forbiddenProse = [
  ["cloudflare", "employee"].join("-"),
  ["authenticated", "employees"].join(" "),
  ["employee", "access", "session"].join(" "),
  ["internal", "stratus"].join(" "),
];
const forbiddenNames = /(^|\/)(\.env|\.dev\.vars|employee\.env)(\.|$)/i;
const credentialPatterns = [
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];
const allowedExamples = new Set([".dev.vars.example", ".env.example"]);
const findings = [];

for (const file of tracked) {
  if (forbiddenNames.test(file) && !allowedExamples.has(file)) findings.push(`${file}: forbidden private environment filename`);
  let text;
  try { text = readFileSync(`${root}/${file}`, "utf8"); } catch { continue; }
  const lower = text.toLowerCase();
  for (const fragment of exactFragments) if (lower.includes(fragment)) findings.push(`${file}: private deployment marker (${fragment})`);
  for (const phrase of forbiddenProse) if (lower.includes(phrase)) findings.push(`${file}: deployment-specific prose (${phrase})`);
  for (const pattern of credentialPatterns) if (pattern.test(text)) findings.push(`${file}: credential-like material (${pattern.source})`);
}

// Public Wrangler config must never carry account-scoped resource ids.
const wrangler = readFileSync(`${root}/wrangler.jsonc`, "utf8");
if (!wrangler.includes('"database_id": "REPLACE_WITH_D1_DATABASE_ID"')) findings.push("wrangler.jsonc: D1 database id must remain a placeholder");
if (!wrangler.includes('"id": "REPLACE_WITH_KV_NAMESPACE_ID"')) findings.push("wrangler.jsonc: KV namespace id must remain a placeholder");

if (findings.length) {
  console.error("Public-clean verification failed:\n" + findings.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`✓ public-clean: ${tracked.length} tracked files checked`);
