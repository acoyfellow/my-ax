#!/usr/bin/env node
// Security + behavior smoke for the trusted inline tool-result registry.
// Bundle the tiny TypeScript module with the already-installed esbuild binary
// so this stays dependency-free and runnable in CI / from a clean checkout.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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

  const { resolveToolResultWidget: resolve } = await import(pathToFileURL(out).href);
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
  const delegation = resolve({ results: [
    { runId: "delegate:one", status: "completed", summary: "Evidence found", attempts: 1, output: { safe: true } },
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
  if (delegation.runs[1].status !== "interrupted" || delegation.runs[1].attempts !== 2) throw new Error("delegation status/attempts missing");

  console.log("✓ trusted inline tool-result widgets: safe replay + raster + delegation snapshot + sandboxed Svelte artifact render; external URLs, SVG, and arbitrary component payloads stay inert");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
