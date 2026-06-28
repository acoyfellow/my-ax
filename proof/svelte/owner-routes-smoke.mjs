#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];
const mustContain = (file, needle, label = needle) => {
  const text = read(file);
  if (!text.includes(needle)) failures.push(`${file}: missing ${label}`);
};

mustContain("src/index.tsx", 'app.use("/attention", accessMiddleware());', "Access middleware for /attention");
mustContain("src/index.tsx", 'app.use("/runs", accessMiddleware());', "Access middleware for /runs");
mustContain("src/index.tsx", 'app.use("/jobs", accessMiddleware());', "Access middleware for /jobs");

mustContain("src/index.tsx", 'app.get("/attention"', "rendered /attention route");
mustContain("src/index.tsx", "data-attention-page", "attention HTML marker");
mustContain("src/index.tsx", "data-attention-next-actions", "attention next-actions marker");
mustContain("src/index.tsx", "data-attention-kind-summary", "attention kind summary marker");
mustContain("src/index.tsx", "data-attention-kind-summary-empty", "attention empty kind summary marker");
mustContain("src/routes/runs.tsx", 'app.get("/runs"', "rendered /runs route");
mustContain("src/routes/runs.tsx", "data-runs-page", "runs HTML marker");
mustContain("src/routes/runs.tsx", "data-runs-status-summary", "runs status summary marker");
mustContain("src/routes/runs.tsx", "data-runs-empty", "runs empty-state marker");
mustContain("src/routes/runs.tsx", "data-runs-next-actions", "runs next-actions marker");
mustContain("src/routes/jobs.ts", 'app.get("/jobs"', "rendered /jobs route");
mustContain("src/routes/jobs.ts", "data-jobs-page", "jobs HTML marker");
mustContain("src/routes/jobs.ts", "data-jobs-status-summary", "jobs status summary marker");
mustContain("src/routes/jobs.ts", "data-jobs-empty", "jobs empty-state marker");
mustContain("src/routes/jobs.ts", "data-jobs-next-actions", "jobs next-actions marker");

mustContain("proof/svelte/CheckIn.svelte", 'href.startsWith("/api/attention")', "Check-in attention API display mapping");
mustContain("proof/svelte/CheckIn.svelte", 'replace("/api/attention", "/attention")', "Check-in attention rendered display mapping");
mustContain("proof/svelte/CheckIn.svelte", 'href.startsWith("/api/runs")', "Check-in runs API display mapping");
mustContain("proof/svelte/CheckIn.svelte", 'replace("/api/runs", "/runs")', "Check-in runs rendered display mapping");
mustContain("proof/svelte/CheckIn.svelte", 'href.startsWith("/api/jobs")', "Check-in jobs API display mapping");
mustContain("proof/svelte/CheckIn.svelte", 'replace("/api/jobs", "/jobs")', "Check-in jobs rendered display mapping");

if (failures.length) {
  console.error("owner-route smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("✓ owner-route smoke: Check-in rendered destinations and Access-guarded owner routes are present");
