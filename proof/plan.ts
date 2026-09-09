import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { proofHttpLayer, runSmokeProof } from "./plan-program";

function loadDevVars(): Record<string, string> {
  try {
    const file = join(dirname(fileURLToPath(import.meta.url)), "..", ".dev.vars");
    if (!existsSync(file)) return {};
    const values: Record<string, string> = {};
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match) values[match[1]] = match[2];
    }
    return values;
  } catch {
    return {};
  }
}

const devVars = loadDevVars();
const baseUrl = process.env.MY_AX_BASE_URL ?? devVars.MY_AX_BASE_URL ?? "";
if (!baseUrl) {
  console.error("MY_AX_BASE_URL required (e.g. https://ax.example.com)");
  process.exit(2);
}

const receipt = await Effect.runPromise(runSmokeProof({
  baseUrl,
  clientId: process.env.CF_ACCESS_CLIENT_ID ?? devVars.CF_ACCESS_CLIENT_ID ?? "",
  clientSecret: process.env.CF_ACCESS_CLIENT_SECRET ?? devVars.CF_ACCESS_CLIENT_SECRET ?? "",
}).pipe(Effect.provide(proofHttpLayer())));

const ansi = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[90m",
  bold: "\x1b[1m",
};

console.log("");
console.log(`${ansi.bold}my-ax smoke proof${ansi.reset}  ${ansi.dim}${baseUrl}${ansi.reset}`);
console.log("");
for (const result of receipt.results) {
  const tag = result.status === "pass" ? `${ansi.green}PASS${ansi.reset}` : `${ansi.red}FAIL${ansi.reset}`;
  console.log(`  ${tag}  ${result.id.padEnd(24)}  ${ansi.dim}${result.durationMs}ms${ansi.reset}  ${result.title}`);
  for (const failure of result.failures) console.log(`        ${ansi.red}↳ ${failure}${ansi.reset}`);
}
console.log("");
const healthDetails = receipt.results.find((result) => result.id === "health-body-ok")?.details ?? {};
if (healthDetails.version) {
  console.log(`  ${ansi.dim}worker version:${ansi.reset} ${healthDetails.version}   ${ansi.dim}region:${ansi.reset} ${healthDetails.region}`);
}
console.log(`  ${ansi.dim}gates:${ansi.reset} ${receipt.results.filter((result) => result.status === "pass").length}/${receipt.results.length}   ${ansi.dim}status:${ansi.reset} ${receipt.status === "pass" ? `${ansi.green}pass${ansi.reset}` : `${ansi.red}fail${ansi.reset}`}`);
console.log("");

if (process.env.PROOF_JSON === "1") console.log(JSON.stringify(receipt, null, 2));
if (receipt.status !== "pass") process.exit(1);
