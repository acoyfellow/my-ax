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

mustContain("src/routes/attention.ts", 'app.get("/attention"', "rendered /attention route");
mustContain("src/routes/attention.ts", "data-attention-page", "attention HTML marker");
mustContain("src/routes/attention.ts", "data-attention-next-actions", "attention next-actions marker");
mustContain("src/routes/attention.ts", "data-attention-kind-summary", "attention kind summary marker");
mustContain("src/routes/attention.ts", "data-attention-kind-summary-empty", "attention empty kind summary marker");
mustContain("src/routes/attention.ts", "data-attention-session-summary", "attention session summary marker");
mustContain("src/routes/attention.ts", "data-attention-session-summary-empty", "attention empty session summary marker");
mustContain("src/routes/attention.ts", "data-attention-view-summary", "attention exact view summary marker");
mustContain("src/routes/attention.ts", "data-attention-empty", "attention empty list marker");
mustContain("src/routes/attention.ts", "data-attention-error", "attention invalid-filter error marker");
mustContain("src/routes/attention.ts", "Unsupported sessionId", "attention invalid-filter owner page");
mustContain("src/routes/attention.ts", "rows.length ? rows.map(formatRenderedAttentionListItem).join(\"\") : formatRenderedAttentionEmptyList()", "attention rendered empty-list fallback");
mustContain("src/routes/attention.ts", "formatRenderedAttentionApiReceiptHref(query)", "attention filtered API receipt href wiring");
mustContain("src/routes/attention.ts", "formatRenderedAttentionPageHtml", "attention page helper wiring");
mustContain("src/routes/attention.ts", "formatRenderedAttentionApiReceiptHref", "attention filtered API receipt href helper");
mustContain("src/routes/attention.ts", "formatRenderedAttentionPageHtml", "attention page HTML helper");
mustContain("docs/architecture.md", "**Attention owner return**", "architecture Attention owner-return contract");
mustContain("docs/architecture.md", "share `buildAttentionListFilter(...)`", "architecture shared Attention filter contract");
mustContain("docs/architecture.md", "Access middleware remains registered in `src/index.tsx`", "architecture Attention Access boundary");
mustContain("docs/architecture.md", "**Rendered owner receipt links**", "architecture rendered owner receipt links contract");
mustContain("docs/architecture.md", "`/runs` preserves `status`", "architecture Runs filtered receipt contract");
mustContain("docs/architecture.md", "`/jobs` preserves `status`", "architecture Jobs filtered receipt contract");
mustContain("src/routes/runs.tsx", 'app.get("/runs"', "rendered /runs route");
mustContain("src/routes/runs.tsx", "data-runs-page", "runs HTML marker");
mustContain("src/routes/runs.tsx", "data-runs-status-summary", "runs status summary marker");
mustContain("src/routes/runs.tsx", "data-runs-empty", "runs empty-state marker");
mustContain("src/routes/runs.tsx", "data-runs-next-actions", "runs next-actions marker");
mustContain("src/routes/runs.tsx", "Unsupported run filter", "runs invalid-filter owner page");
mustContain("src/routes/runs.tsx", 'href="/api/runs">API receipt', "runs invalid-filter API receipt action");
mustContain("src/routes/runs.tsx", "formatRenderedRunsApiReceiptHref(status)", "runs filtered API receipt href wiring");
mustContain("src/routes/jobs.ts", 'app.get("/jobs"', "rendered /jobs route");
mustContain("src/routes/jobs.ts", "data-jobs-page", "jobs HTML marker");
mustContain("src/routes/jobs.ts", "data-jobs-status-summary", "jobs status summary marker");
mustContain("src/routes/jobs.ts", "data-jobs-empty", "jobs empty-state marker");
mustContain("src/routes/jobs.ts", "data-jobs-next-actions", "jobs next-actions marker");
mustContain("src/routes/jobs.ts", "Unsupported job filter", "jobs invalid-filter owner page");
mustContain("src/routes/jobs.ts", "data-jobs-error", "jobs invalid-filter error marker");
mustContain("src/routes/jobs.ts", 'href="${apiReceiptHref}">API receipt', "jobs invalid-filter API receipt action");
mustContain("src/routes/jobs.ts", "formatRenderedJobsApiReceiptHref(input.status)", "jobs filtered API receipt href wiring");

mustContain("proof/svelte/CheckIn.svelte", "displayCheckInHref", "Check-in rendered destination helper usage");
mustContain("proof/svelte/check-in-display-href.ts", 'href.startsWith("/api/attention")', "Check-in attention API display mapping");
mustContain("proof/svelte/check-in-display-href.ts", 'replace("/api/attention", "/attention")', "Check-in attention rendered display mapping");
mustContain("proof/svelte/check-in-display-href.ts", 'href.startsWith("/api/runs")', "Check-in runs API display mapping");
mustContain("proof/svelte/check-in-display-href.ts", 'replace("/api/runs", "/runs")', "Check-in runs rendered display mapping");
mustContain("proof/svelte/check-in-display-href.ts", 'href.startsWith("/api/jobs")', "Check-in jobs API display mapping");
mustContain("proof/svelte/check-in-display-href.ts", 'replace("/api/jobs", "/jobs")', "Check-in jobs rendered display mapping");

if (failures.length) {
  console.error("owner-route smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("✓ owner-route smoke: Check-in rendered destinations and Access-guarded owner routes are present");
