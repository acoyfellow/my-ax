#!/usr/bin/env node
// Security + behavior smoke for the trusted inline tool-result registry.
// Bundle the tiny TypeScript module with the already-installed esbuild binary
// so this stays dependency-free and runnable in CI / from a clean checkout.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "myax-tool-widgets-"));
const out = join(dir, "registry.mjs");

try {
  execFileSync("./node_modules/.bin/esbuild", [
    "proof/svelte/tool-result-widgets.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    `--outfile=${out}`,
  ], { stdio: "ignore" });

  const { resolveToolResultWidget: resolve, selectVisibleReusableToolCandidates } = await import(pathToFileURL(out).href);
  const png = "data:image/png;base64,QUJD";
  const safeReplay = resolve({ kind: "browser-run", status: "done", replayUrl: "/browser/replay/abc-123", screenshotSrc: "/api/artifacts/22222222-2222-4222-8222-222222222222" }, "browser_open");
  const externalReplay = resolve({ kind: "browser-run", status: "done", replayUrl: "https://evil.example/replay", screenshotSrc: "https://evil.example/screenshot.png" }, "browser_open");
  const raster = resolve({ content: png }, "machinectl_call");
  const artifact = resolve({ content: { kind: "raster-artifact", src: "/api/artifacts/11111111-1111-4111-8111-111111111111" } }, "machinectl_call");
  const codemodeArtifact = resolve({ ok: true, result: { kind: "raster-artifact", src: "/api/artifacts/33333333-3333-4333-8333-333333333333" }, logs: [] }, "machinectl_code");
  const externalArtifact = resolve({ kind: "raster-artifact", src: "https://evil.example/screenshot.png" }, "machinectl_call");
  const svelteArtifact = resolve({ kind: "svelte-artifact", artifactId: "44444444-4444-4444-8444-444444444444", title: "Counter", src: "/api/artifacts/44444444-4444-4444-8444-444444444444/preview" }, "create_svelte_artifact");
  const mismatchedSvelteArtifact = resolve({ kind: "svelte-artifact", artifactId: "44444444-4444-4444-8444-444444444444", title: "Bad", src: "/api/artifacts/55555555-5555-4555-8555-555555555555/preview" }, "create_svelte_artifact");
  const externalSvelteArtifact = resolve({ kind: "svelte-artifact", artifactId: "55555555-5555-4555-8555-555555555555", title: "Bad", src: "https://evil.example/widget" }, "create_svelte_artifact");
  const svg = resolve("data:image/svg+xml;base64,PHN2Zz4=", "machinectl_call");
  const arbitrary = resolve({ html: "<script>alert(1)</script>", component: "Anything" }, "tool");

  // ── Reusable-tool candidate: frozen producer shape (work_code result carries
  //    suggestedRecipe AND reusableToolCandidate metadata). Fails closed on any
  //    missing field, non-eligible flag, empty fingerprint, wrong tool name, or
  //    unrecognized capability strings. ─────────────────────────────────────
  const goodCandidateInput = {
    ok: true,
    result: { wrote: true },
    sourceCode: "async () => await workspace.write({ path: '/tmp/a.txt', content: 'hi' })",
    inferredCapabilities: ["workspace.write"],
    suggestedRecipe: {
      name: "WriteTmpNote",
      description: "Writes a small note to /tmp for later review.",
      code: "async () => await workspace.write({ path: '/tmp/a.txt', content: 'hi' })",
      capabilities: ["workspace.write"],
    },
    reusableToolCandidate: { eligible: true, fingerprint: "fp-write-tmp-note", reason: "portable" },
    source: "work_code",
  };
  const candidate = resolve(goodCandidateInput, "work_code");
  if (candidate.kind !== "reusable-tool-candidate") throw new Error("valid work_code candidate must resolve to reusable-tool-candidate");
  if (candidate.fingerprint !== "fp-write-tmp-note") throw new Error("candidate fingerprint must be preserved");
  if (candidate.proposedName !== "WriteTmpNote") throw new Error("candidate proposedName must come from suggestedRecipe.name");
  if (candidate.proposedDescription !== "Writes a small note to /tmp for later review.") throw new Error("candidate proposedDescription must come from suggestedRecipe.description");
  if (candidate.capabilities.length !== 1 || candidate.capabilities[0] !== "workspace.write") throw new Error("candidate capabilities must reflect the exact inferred capabilities");
  if (typeof candidate.source !== "string" || !candidate.source.length) throw new Error("candidate source label must be a bounded string");
  if (typeof candidate.sourceCode !== "string" || !candidate.sourceCode.includes("workspace.write")) throw new Error("candidate sourceCode preview must be present");
  if (typeof candidate.resultPreview !== "string" || !candidate.resultPreview.includes("wrote")) throw new Error("candidate resultPreview must be present");
  if ("saveEndpoint" in candidate) throw new Error("compatibility API endpoint must not appear on the owner-visible reusable-tool card");
  if ("ok" in candidate) throw new Error("owner-visible reusable-tool card must not expose the raw ok flag");

  // Fail-closed conditions: any missing gate must fall through to raw-text.
  const wrongTool = resolve(goodCandidateInput, "search");
  if (wrongTool.kind !== "raw-text") throw new Error("non-work_code tool must never render a reusable-tool card");
  const errored = resolve({ ...goodCandidateInput, ok: false, error: "boom" }, "work_code");
  if (errored.kind !== "raw-text") throw new Error("work_code with ok=false must fall through to raw-text");
  const ineligible = resolve({ ...goodCandidateInput, reusableToolCandidate: { ...goodCandidateInput.reusableToolCandidate, eligible: false } }, "work_code");
  if (ineligible.kind !== "raw-text") throw new Error("reusableToolCandidate.eligible=false must fall through to raw-text");
  const missingMetadata = resolve({ ...goodCandidateInput, reusableToolCandidate: undefined }, "work_code");
  if (missingMetadata.kind !== "raw-text") throw new Error("missing reusableToolCandidate metadata must fall through to raw-text");
  const emptyFingerprint = resolve({ ...goodCandidateInput, reusableToolCandidate: { eligible: true, fingerprint: "   ", reason: "portable" } }, "work_code");
  if (emptyFingerprint.kind !== "raw-text") throw new Error("empty/whitespace fingerprint must fall through to raw-text");
  const missingRecipe = resolve({ ...goodCandidateInput, suggestedRecipe: undefined }, "work_code");
  if (missingRecipe.kind !== "raw-text") throw new Error("missing suggestedRecipe must fall through to raw-text");
  const missingName = resolve({ ...goodCandidateInput, suggestedRecipe: { ...goodCandidateInput.suggestedRecipe, name: "" } }, "work_code");
  if (missingName.kind !== "raw-text") throw new Error("missing proposed name must fall through to raw-text");
  const unsafeCap = resolve({ ...goodCandidateInput, inferredCapabilities: ["workspace.write", "network.fetch"] }, "work_code");
  if (unsafeCap.kind !== "raw-text") throw new Error("unrecognized capability must fall through to raw-text");
  const missingCaps = resolve({ ...goodCandidateInput, inferredCapabilities: undefined }, "work_code");
  if (missingCaps.kind !== "raw-text") throw new Error("missing inferredCapabilities must fall through to raw-text");
  // Historical results without the metadata (older transcripts) show the ordinary
  // inert receipt, never a candidate card.
  const historicalNoMetadata = resolve({ ok: true, result: { wrote: true }, sourceCode: "async () => 1", inferredCapabilities: ["workspace.write"], suggestedRecipe: { name: "Old", code: "x" } }, "work_code");
  if (historicalNoMetadata.kind !== "raw-text") throw new Error("historical work_code without reusableToolCandidate must render inert raw text");

  // ── Duplicate-collapse helper: newest per fingerprint is the visible card. ──
  const receipts = [
    { id: "t1", widgetKind: "reusable-tool-candidate", fingerprint: "fp-a" },
    { id: "t2", widgetKind: "reusable-tool-candidate", fingerprint: "fp-b" },
    { id: "t3", widgetKind: "reusable-tool-candidate", fingerprint: "fp-a" }, // newer duplicate of fp-a
    { id: "t4", widgetKind: "raw-text" },
    { id: "t5", widgetKind: "reusable-tool-candidate", fingerprint: "fp-a" }, // newest fp-a
  ];
  const visible = selectVisibleReusableToolCandidates(receipts);
  if (!(visible instanceof Set)) throw new Error("selectVisibleReusableToolCandidates must return a Set");
  if (visible.size !== 2) throw new Error(`newest-per-fingerprint set size wrong: ${visible.size}`);
  if (!visible.has("t5")) throw new Error("newest fp-a receipt must be visible");
  if (!visible.has("t2")) throw new Error("only fp-b receipt must be visible");
  if (visible.has("t1") || visible.has("t3")) throw new Error("older duplicates of fp-a must NOT be visible");
  if (visible.has("t4")) throw new Error("non-candidate widget kinds must never appear in the visible-candidate set");
  const emptyVisible = selectVisibleReusableToolCandidates([]);
  if (emptyVisible.size !== 0) throw new Error("empty receipt list must produce an empty visible set");
  const noCandidates = selectVisibleReusableToolCandidates([
    { id: "raw", widgetKind: "raw-text" },
    { id: "img", widgetKind: "inline-raster-image" },
  ]);
  if (noCandidates.size !== 0) throw new Error("no reusable-tool candidates must produce an empty visible set");
  const singleCandidate = selectVisibleReusableToolCandidates([
    { id: "solo", widgetKind: "reusable-tool-candidate", fingerprint: "fp-solo" },
  ]);
  if (singleCandidate.size !== 1 || !singleCandidate.has("solo")) throw new Error("single candidate must be visible");

  const delegation = resolve({ results: [
    { runId: "delegate:one", taskFingerprint: "a1b2c3d4", label: "Research evidence", status: "completed", summary: "Evidence found", attempts: 1, output: { safe: true } },
    { runId: "delegate:two", status: "interrupted", error: "Worker restarted", attempts: 2 },
    { runId: "delegate:three", status: "error", error: "must be capped" },
  ], synthesisRequired: true }, "delegate_many");

  if (safeReplay.kind !== "browser-run" || safeReplay.replaySrc !== "/browser/replay/abc-123?embed=1" || safeReplay.screenshotSrc !== "/api/artifacts/22222222-2222-4222-8222-222222222222") throw new Error("safe same-origin replay/screenshot missing");
  if (externalReplay.kind !== "browser-run" || externalReplay.replaySrc || externalReplay.screenshotSrc) throw new Error("external replay/screenshot URL was not blocked");
  if (raster.kind !== "inline-raster-image") throw new Error("safe raster widget missing");
  if (artifact.kind !== "inline-raster-image") throw new Error("safe same-origin raster artifact missing");
  if (codemodeArtifact.kind !== "inline-raster-image") throw new Error("machinectl_code raster result envelope missing");
  if (externalArtifact.kind !== "raw-text") throw new Error("external raster artifact URL must remain inert raw text");
  if (svelteArtifact.kind !== "svelte-artifact") throw new Error("same-origin Svelte artifact preview missing");
  if (mismatchedSvelteArtifact.kind !== "raw-text") throw new Error("Svelte artifact id and preview path must match");
  if (externalSvelteArtifact.kind !== "raw-text") throw new Error("external Svelte artifact URL must remain inert raw text");
  if (svg.kind !== "raw-text") throw new Error("SVG must remain inert raw text");
  if (arbitrary.kind !== "raw-text") throw new Error("arbitrary model-adjacent widget payload must remain inert raw text");
  if (delegation.kind !== "delegation-group" || delegation.live !== false || delegation.runs.length !== 2) throw new Error("delegate_many terminal snapshot missing or unbounded");
  if (delegation.runs[0].taskFingerprint !== "a1b2c3d4" || delegation.runs[0].label !== "Research evidence" || delegation.runs[1].status !== "interrupted" || delegation.runs[1].attempts !== 2) throw new Error("delegation metadata/status/attempts missing");

  // ── Widget copy + action + receipt preservation contract ────────────────
  const widgetSource = readFileSync("proof/svelte/ToolResultWidget.svelte", "utf8");
  if (!widgetSource.includes("Reusable tool")) throw new Error("reusable-tool card must use the 'Reusable tool' label");
  if (/\bSnippet(\s|,|\.)/.test(widgetSource) || /\bsnippet(\s|,|\.)/.test(widgetSource)) throw new Error("owner-visible card must not use snippet copy");
  if (/\brecipe\b/i.test(widgetSource) && !widgetSource.includes("reusable-tool-candidate")) throw new Error("owner-visible card must not use raw recipe copy");
  if (widgetSource.includes("/api/recipes")) throw new Error("compatibility API endpoint must not appear on the owner-visible card");
  if (widgetSource.includes("saveEndpoint")) throw new Error("owner-visible card must not reference the compatibility endpoint field");
  if (!widgetSource.includes("Review reusable tool")) throw new Error("card must expose a 'Review reusable tool' action");
  if (!/min-h-\[44px\]/.test(widgetSource)) throw new Error("Review reusable tool button must reserve a >=44px touch target");
  if (!widgetSource.includes("my-ax:settings-open")) throw new Error("Review action must dispatch my-ax:settings-open");
  if (!/section:\s*"recipes"/.test(widgetSource) || !/recipeName:\s*widget\.proposedName/.test(widgetSource)) throw new Error("Review action must carry {section:'recipes', recipeName:<proposed name>} detail");

  const chatSource = readFileSync("proof/svelte/Chat.svelte", "utf8");
  // Every underlying tool-call receipt container must remain — the collapse
  // logic downgrades the widget kind but never removes the <details> row.
  if (!chatSource.includes("selectVisibleReusableToolCandidates")) throw new Error("Chat must consume the duplicate-collapse helper");
  if (!chatSource.includes("isSuppressedCandidate")) throw new Error("Chat must mark suppressed duplicate candidate receipts");
  if (!chatSource.includes("data-tool-id={tool.id}")) throw new Error("Chat must preserve per-tool receipt containers");

  console.log("✓ trusted inline tool-result widgets: reusable-tool candidate fails closed, newest-per-fingerprint helper is deterministic, action dispatches settings CustomEvent, receipts are preserved");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
