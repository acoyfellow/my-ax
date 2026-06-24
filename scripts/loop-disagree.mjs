#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const roleNames = ["builder", "skeptic", "historian"];
const voteTerms = ["majority vote", "vote", "voted", "2-1", "two to one", "consensus says"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function slugify(value) {
  return String(value || "target")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "target";
}

export function fingerprint(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

export function buildPrompts(target) {
  const normalized = String(target || "").trim();
  if (!normalized) throw new Error("target is required");
  return {
    builder: `Role: builder. Read-only. Review ${normalized}. Make the strongest evidence-backed case that the plan/change is executable. Return concrete executable steps, required receipts/proofs, missing blockers, and one recommendation. Do not edit files.`,
    skeptic: `Role: skeptic. Read-only. Review ${normalized}. Find concrete failure modes, safety gaps, missing evidence, and unauditable claims. Return evidence-backed defects, missing proof, and one recommendation. Do not edit files.`,
    historian: `Role: historian. Read-only. Review ${normalized} plus nearby docs/receipts/history. Find relevant prior artifacts, similarities/differences, missing precedent, and one recommendation. Do not edit files.`,
  };
}

function evidenceLines(evidence = []) {
  return evidence.map((item) => `    { "kind": "${item.kind}", "ref": "${item.ref}" }`).join(",\n");
}

export function buildReceipt({ target, runs, decision = "", status = "continue", claims = "", synthesis = "", evidence = [] }) {
  const prompts = buildPrompts(target);
  const taskFingerprint = fingerprint(`${target}\n${Object.values(prompts).join("\n")}`);
  const nonce = randomUUID();
  const ev = [
    ...roleNames.map((role) => ({ kind: "run_id", ref: runs?.[role] || `<${role}-run-id>` })),
    ...evidence,
  ];
  return `# loop disagreement review — ${slugify(target)} (${today()})

## Receipt envelope

\`\`\`json
{
  "schema": "depth.receipt.v1",
  "experiment": "my-ax-loop-disagreement-review",
  "iteration": "${today()}",
  "producer": "parent",
  "producer_id": "",
  "task_fingerprint": "${taskFingerprint}",
  "nonce": "${nonce}",
  "predecessor_hash": null,
  "status": "${status}",
  "decision": "${decision.replaceAll('"', '\\"')}",
  "evidence": [
${evidenceLines(ev)}
  ],
  "artifact_hashes": [],
  "created_at": "${new Date().toISOString()}"
}
\`\`\`

## Target

${target}

## Role prompts

### builder

${prompts.builder}

### skeptic

${prompts.skeptic}

### historian

${prompts.historian}

## Child runs

- builder: ${runs?.builder || ""}
- skeptic: ${runs?.skeptic || ""}
- historian: ${runs?.historian || ""}

## Decision-changing claims

${claims || "- <claim> — evidence: <path|run_id|missing proof>; plan delta: <delta>"}

## Synthesis — no voting

${synthesis || "Synthesize only evidence-backed deltas. Do not count votes or choose the most confident child."}

## Parent decision

${decision || "continue | pass | fail | ask | stop"}

## Next

<one bounded next action>
`;
}

export function verifyReceiptText(text) {
  const failures = [];
  for (const role of roleNames) {
    if (!new RegExp(`- ${role}:\\s*ter_`).test(text)) failures.push(`missing attributable ${role} run id`);
  }
  for (const heading of ["## Decision-changing claims", "## Synthesis — no voting", "## Parent decision", "\"schema\": \"depth.receipt.v1\""]) {
    if (!text.includes(heading)) failures.push(`missing ${heading}`);
  }
  const lower = text.toLowerCase();
  for (const term of voteTerms) {
    if (lower.includes(term)) failures.push(`forbidden voting language: ${term}`);
  }
  if (!/(kind|evidence):|missing proof|run_id|path/.test(text)) failures.push("missing evidence or missing-proof reference");
  return { ok: failures.length === 0, failures };
}

async function writeUnique(path, content) {
  let candidate = path;
  let n = 2;
  while (true) {
    try {
      await writeFile(candidate, content, { flag: "wx" });
      return candidate;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      candidate = path.replace(/\.md$/, `-${n}.md`);
      n += 1;
    }
  }
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const value = rest[i];
    if (value?.startsWith("--")) {
      const key = value.slice(2);
      opts[key] = rest[i + 1];
      i += 1;
    } else {
      opts._.push(value);
    }
  }
  return { cmd, opts };
}

async function main(argv = process.argv.slice(2)) {
  const { cmd, opts } = parseArgs(argv);
  if (!cmd || ["help", "--help", "-h"].includes(cmd)) {
    console.log("usage: node scripts/loop-disagree.mjs plan <target> | receipt <target> --builder ter_... --skeptic ter_... --historian ter_... [--out dir] | verify <receipt.md>");
    return;
  }
  if (cmd === "plan") {
    const target = opts._.join(" ");
    const prompts = buildPrompts(target);
    console.log(JSON.stringify({ target, prompts, terrariumStrategy: "allSettled", rule: "parent synthesizes evidence-backed deltas; no voting" }, null, 2));
    return;
  }
  if (cmd === "receipt") {
    const target = opts._.join(" ");
    const outDir = resolve(opts.out || ".context/runs");
    await mkdir(outDir, { recursive: true });
    const content = buildReceipt({ target, runs: { builder: opts.builder, skeptic: opts.skeptic, historian: opts.historian } });
    const path = await writeUnique(join(outDir, `${today()}-loop-disagree-${slugify(basename(target) || target)}.md`), content);
    console.log(path);
    return;
  }
  if (cmd === "verify") {
    const path = opts._[0];
    if (!path) throw new Error("verify requires a receipt path");
    const result = verifyReceiptText(await readFile(path, "utf8"));
    if (!result.ok) {
      console.error(result.failures.join("\n"));
      process.exitCode = 1;
      return;
    }
    console.log(`verify ok: ${path}`);
    return;
  }
  throw new Error(`unknown command: ${cmd}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
