#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";

const PRODUCTION_D1 = "my-ax-db";
const PRODUCTION_BUCKETS = new Set(["my-ax-homes", "my-ax-uploads"]);
const PRODUCTION_SANDBOX = "my-ax-sandbox";

export function findSharedProductionResources(config, environmentName) {
  const environment = config?.env?.[environmentName];
  if (!environment) return [`env.${environmentName} does not exist`];

  const problems = [];

  for (const bucket of environment.r2_buckets ?? []) {
    if (PRODUCTION_BUCKETS.has(bucket.bucket_name)) {
      problems.push(`env.${environmentName} binds ${bucket.binding} to the production bucket ${bucket.bucket_name}`);
    }
  }

  for (const database of environment.d1_databases ?? []) {
    if (database.database_name === PRODUCTION_D1) {
      problems.push(`env.${environmentName} binds ${database.binding} to the production database ${PRODUCTION_D1}`);
    }
  }

  for (const container of environment.containers ?? []) {
    if (container.name === PRODUCTION_SANDBOX) {
      problems.push(`env.${environmentName} binds a container to the production sandbox ${PRODUCTION_SANDBOX}`);
    }
  }

  const productionD1Ids = new Set(
    (config.d1_databases ?? []).map((database) => database.database_id).filter((id) => typeof id === "string" && id !== "" && !id.startsWith("REPLACE_")),
  );
  for (const database of environment.d1_databases ?? []) {
    if (productionD1Ids.has(database.database_id)) {
      problems.push(`env.${environmentName} binds ${database.binding} to the production database id`);
    }
  }

  return problems;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const path = new URL("../wrangler.jsonc", import.meta.url);
  const errors = [];
  const config = parse(readFileSync(path, "utf8"), errors, { allowTrailingComma: true });
  if (!config || errors.length > 0) {
    console.error("verify-preview-isolation: could not parse wrangler.jsonc");
    process.exit(2);
  }

  const environments = process.argv.slice(2);
  const targets = environments.length > 0 ? environments : Object.keys(config.env ?? {});
  const problems = targets.flatMap((name) => findSharedProductionResources(config, name));

  if (problems.length > 0) {
    console.error("verify-preview-isolation: a non-production environment can write production data.");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error("");
    console.error("A preview or dev deploy must own its data. Give the environment its own");
    console.error("bucket, database, and sandbox names.");
    process.exit(1);
  }

  console.log(`verify-preview-isolation: ok, ${targets.length} environment(s) own their data`);
}
