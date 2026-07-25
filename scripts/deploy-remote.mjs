#!/usr/bin/env node
// deploy-remote.mjs — Class A machine-free, Docker-free deploy for My AX.
//
// WHY: `wrangler deploy` normally needs a Docker daemon because
// wrangler.jsonc references the Sandbox container as `image: "./Dockerfile"`,
// and wrangler tries to build it. But if the Dockerfile/context has NOT
// changed, there is nothing new to build — we can deploy the Worker while
// PINNING the container to the image already in the registry. A pinned
// registry image reference requires no Docker.
//
// This script:
//   1. Refuses to run if the Dockerfile changed vs the last CI-built image
//      (that needs a real builder -> use the GitHub Actions `deploy` workflow).
//   2. Rewrites containers[].image to the pinned registry ref.
//   3. Runs `wrangler deploy` with that override config.
//
// Runs anywhere with node + network + a scoped CLOUDFLARE_API_TOKEN: the My AX
// workspace container, a Terrarium run, or any box. No laptop, no Docker.
//
// ENV:
//   CLOUDFLARE_API_TOKEN   required — scoped Workers Scripts:Edit (+ D1/R2 as needed)
//   CLOUDFLARE_ACCOUNT_ID  required
//   MY_AX_SANDBOX_IMAGE    required — registry ref of the last CI-built image,
//                          e.g. registry.cloudflare.com/<acct>/my-ax-sandbox:<tag-or-digest>
//                          (the `deploy` workflow prints/uploads this as sandbox-images)
//   CF_ACCESS_AUD, CF_ACCESS_ISS, BRIDGE_BASE_URL   deploy-time vars (optional overrides)
//
// FLAGS:
//   --dry-run   build + print the plan, run `wrangler deploy --dry-run`, deploy nothing
//   --allow-dockerfile-change   escape hatch: proceed even if the Dockerfile hash moved
//                               (only safe if MY_AX_SANDBOX_IMAGE already matches it)

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const ALLOW_DF = argv.includes("--allow-dockerfile-change");

function die(msg) { console.error(`\n[deploy-remote] FATAL: ${msg}\n`); process.exit(1); }
function info(msg) { console.log(`[deploy-remote] ${msg}`); }
function sh(cmd, opts = {}) { return execSync(cmd, { stdio: "inherit", ...opts }); }

// --- 0. Preconditions -------------------------------------------------------
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const image = process.env.MY_AX_SANDBOX_IMAGE;
if (!token) die("CLOUDFLARE_API_TOKEN is not set.");
if (!account) die("CLOUDFLARE_ACCOUNT_ID is not set.");
if (!image) die("MY_AX_SANDBOX_IMAGE is not set (pinned registry image from the last CI build).");
if (!existsSync(path.join(ROOT, "wrangler.jsonc"))) die("run from the my-ax repo root (wrangler.jsonc not found).");

// --- 1. Dockerfile-change guard --------------------------------------------
// If the Dockerfile hash changed since the pinned image was built, a code-only
// deploy would ship stale container behaviour. Refuse and route to CI.
const dfPath = path.join(ROOT, "Dockerfile");
const dfHash = createHash("sha256").update(readFileSync(dfPath)).digest("hex").slice(0, 12);
const lockPath = path.join(ROOT, ".sandbox-image.lock");
let recordedHash = null;
if (existsSync(lockPath)) {
  try { recordedHash = JSON.parse(readFileSync(lockPath, "utf8")).dockerfileHash; } catch {}
}
info(`Dockerfile sha256:${dfHash}  pinned image: ${image}`);
if (recordedHash && recordedHash !== dfHash && !ALLOW_DF) {
  die(
    `Dockerfile changed (recorded ${recordedHash} != current ${dfHash}).\n` +
    `A container rebuild needs Docker. Run the GitHub Actions "deploy" workflow ` +
    `(Class B), then update ${path.basename(lockPath)} + MY_AX_SANDBOX_IMAGE.\n` +
    `Override with --allow-dockerfile-change only if the pinned image already matches.`
  );
}
if (!recordedHash) {
  info(`No .sandbox-image.lock yet — writing one so future runs can guard. ` +
       `(First run trusts MY_AX_SANDBOX_IMAGE matches the current Dockerfile.)`);
  writeFileSync(lockPath, JSON.stringify({ dockerfileHash: dfHash, image }, null, 2) + "\n");
}

// --- 2. Build a pinned override config --------------------------------------
// Replace `"image": "./Dockerfile"` with the registry ref so wrangler pulls the
// existing image instead of invoking Docker.
const cfgRaw = readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
const imageRe = /"image"\s*:\s*"\.\/Dockerfile"/g;
const found = cfgRaw.match(imageRe)?.length ?? 0;
if (found === 0) {
  die(`Could not find "image": "./Dockerfile" in wrangler.jsonc — config shape changed; update this script.`);
}
// wrangler.jsonc defines the Sandbox container more than once (top-level prod +
// per-env override blocks). Pin EVERY occurrence, or a stray "./Dockerfile"
// would still force a Docker build. Replace globally and verify none remain.
const pinned = cfgRaw.replace(imageRe, `"image": ${JSON.stringify(image)}`);
const remaining = pinned.match(/"image"\s*:\s*"\.\/Dockerfile"/g)?.length ?? 0;
if (remaining !== 0) die(`Pinning incomplete: ${remaining} "./Dockerfile" ref(s) remain after rewrite.`);
info(`Pinned ${found} container image ref(s) to the registry image.`);
const outCfg = path.join(ROOT, "wrangler.deploy.jsonc");
writeFileSync(outCfg, pinned);
info(`Wrote pinned override config -> ${path.basename(outCfg)}`);

// --- 3. Build assets (no Docker) --------------------------------------------
info("Building assets (css/brand/vendor/docs/svelte)...");
sh("npm run build:assets");

// --- 4. Deploy --------------------------------------------------------------
const varFlags = [
  ["CF_ACCESS_AUD", process.env.CF_ACCESS_AUD],
  ["CF_ACCESS_ISS", process.env.CF_ACCESS_ISS],
  ["BRIDGE_BASE_URL", process.env.BRIDGE_BASE_URL],
  ["CLOUDFLARE_ACCOUNT_ID", account],
].filter(([, v]) => v != null && v !== "")
 .map(([k, v]) => `--var ${k}:${JSON.stringify(v)}`)
 .join(" ");

const base = `npx wrangler deploy -c ${JSON.stringify(outCfg)} --account-id ${JSON.stringify(account)} ${varFlags}`;
if (DRY) {
  info("DRY RUN — validating bundle/config, deploying nothing.");
  sh(`${base} --dry-run --outdir /tmp/my-ax-remote-out`, { env: { ...process.env } });
  info("Dry run OK. Remove --dry-run to deploy for real.");
} else {
  info("Deploying Worker with pinned container image (no Docker)...");
  sh(base, { env: { ...process.env } });
  info("Deploy complete. Verify: authenticated GET /api/health should return ok:true.");
}
