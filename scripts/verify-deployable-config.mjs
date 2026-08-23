#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";

const path = new URL("../wrangler.jsonc", import.meta.url);
const errors = [];
const config = parse(readFileSync(path, "utf8"), errors, { allowTrailingComma: true });

if (!config || errors.length > 0) {
  console.error("verify-deployable-config: could not parse wrangler.jsonc");
  process.exit(2);
}

const problems = [];
const routes = Array.isArray(config.routes) ? config.routes : [];
if (routes.length === 0) {
  problems.push("routes is empty, so the deploy would drop the custom domain");
}
for (const name of ["CF_ACCESS_AUD", "CF_ACCESS_ISS"]) {
  const value = config.vars?.[name];
  if (typeof value !== "string" || value.trim() === "") {
    problems.push(`vars.${name} is empty, so the deploy would blank the Access configuration`);
  }
}

if (problems.length > 0) {
  console.error("verify-deployable-config: this wrangler.jsonc is not deployable to production.");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("");
  console.error("The public repo ships these empty on purpose. Run the deploy workflow from the");
  console.error("repository that carries the real routes and Access values.");
  process.exit(1);
}

console.log(`verify-deployable-config: ok, ${routes.length} route(s) and Access vars are set`);
