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
mustContain("src/routes/attention.ts", 'app.post("/attention/seen"', "rendered Attention seen route");
mustContain("src/routes/attention.ts", "data-attention-seen-form", "rendered Attention seen form marker");
mustContain("src/routes/attention.ts", 'action="/attention/seen"', "rendered Attention seen form action");
mustContain("src/routes/attention.ts", "origin !== url.origin", "rendered Attention seen same-origin guard");
mustContain("src/routes/attention.ts", "formatRenderedAttentionReturnHref(query)", "rendered Attention seen filtered return href wiring");
mustContain("src/routes/attention.test.ts", "formatRenderedAttentionReturnHref preserves rendered filters after seen posts", "Attention seen filtered return href test");
mustContain("src/routes/attention.ts", "rows.length ? rows.map(formatRenderedAttentionListItem).join(\"\") : formatRenderedAttentionEmptyList()", "attention rendered empty-list fallback");
mustContain("src/routes/attention.ts", "formatRenderedAttentionApiReceiptHref(query)", "attention filtered API receipt href wiring");
mustContain("src/routes/attention.ts", "formatRenderedAttentionPageHtml", "attention page helper wiring");
mustContain("src/routes/attention.ts", "formatRenderedAttentionApiReceiptHref", "attention filtered API receipt href helper");
mustContain("src/routes/attention.ts", "formatRenderedAttentionPageHtml", "attention page HTML helper");
mustContain("docs/architecture.md", "**Attention owner return**", "architecture Attention owner-return contract");
mustContain("docs/architecture.md", "share `buildAttentionListFilter(...)`", "architecture shared Attention filter contract");
mustContain("docs/architecture.md", "Access middleware remains registered in `src/index.tsx`", "architecture Attention Access boundary");
mustContain("docs/architecture.md", "same-origin `data-attention-seen-form`", "architecture Attention seen form contract");
mustContain("docs/architecture.md", "same-origin `Origin` guard", "architecture Attention seen origin guard contract");
mustContain("docs/architecture.md", "formatRenderedAttentionReturnHref(...)", "architecture Attention seen return helper contract");
mustContain("docs/architecture.md", "**Rendered owner receipt links**", "architecture rendered owner receipt links contract");
mustContain("docs/architecture.md", "`/runs` preserves `status`", "architecture Runs filtered receipt contract");
mustContain("docs/architecture.md", "`/jobs` preserves `status`", "architecture Jobs filtered receipt contract");
mustContain("docs/architecture.md", "Invalid rendered filters are not propagated into raw receipt links", "architecture invalid-filter receipt contract");
mustContain("docs/architecture.md", "unsupported `/attention?sessionId=...`", "architecture Attention invalid-filter receipt contract");
mustContain("docs/architecture.md", "unfiltered `/api/attention`, `/api/runs`, or `/api/jobs` receipt", "architecture invalid-filter unfiltered receipt targets");
mustContain("docs/feature-matrix.md", "data-attention-seen-form", "feature matrix Attention seen form marker");
mustContain("docs/feature-matrix.md", "marks the current filtered view seen", "feature matrix Attention seen form behavior");
mustContain("docs/feature-matrix.md", "rendered `/runs` owner views preserve valid status filters", "feature matrix Runs rendered filter contract");
mustContain("docs/feature-matrix.md", "exact status summaries", "feature matrix Runs exact summary contract");
mustContain("docs/feature-matrix.md", "authoritative API receipt", "feature matrix Runs API receipt contract");
mustContain("docs/feature-matrix.md", "rendered `/jobs` owner views preserve valid status filters", "feature matrix Jobs rendered filter contract");
mustContain("docs/feature-matrix.md", "exact active/paused summaries", "feature matrix Jobs exact summary contract");
mustContain("docs/feature-matrix.md", "src/routes/jobs.ts", "feature matrix Jobs route evidence");
mustContain("README.md", "data-attention-seen-form", "README Attention seen form marker");
mustContain("README.md", "mark the current filtered view seen", "README Attention seen form behavior");
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
mustContain("src/routes/jobs.ts", "data-job-history-receipt-href", "jobs item raw history receipt marker");
mustContain("docs/feature-matrix.md", "per-job history receipt links", "feature matrix Jobs history receipt contract");

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
