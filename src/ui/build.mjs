// Build my-ax's Svelte 5 client artifacts via svelte-hono.
//
// Produces, into proof/svelte/build/:
//   - _runtime bundle (shared Svelte runtime, content-hashed, ~108 KB once)
//   - _shared_*  bundles for cross-component modules (eg. store.svelte.ts)
//   - one client-<id>.js per component (each ~2–33 KB after externalizing)
//   - bundles.generated.ts (the typed registry the worker imports)
//
// And, alongside each .svelte source:
//   - <Name>.ssr.mjs  pre-compiled svelte/server modules imported by the
//                     thin Hono JSX page shells. Wrangler's
//                     built-in esbuild can't load .svelte files, so we
//                     compile them ourselves.
//
// Run via: npm run build:svelte (called from build:assets, which is
// invoked by dev and deploy).

import { build } from "esbuild";
import sveltePlugin from "esbuild-svelte";
import { buildHonoSvelte } from "svelte-hono/build";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { VERSION as SVELTE_VERSION } from "svelte/compiler";

const __dirname = dirname(fileURLToPath(import.meta.url));
const here = (p) => join(__dirname, p);

// Clean generated artifacts first. Components are intentionally removed as the
// product contracts; stale ignored bundles must not linger and confuse local
// smoke tests or future archaeology.
rmSync(here("build"), { recursive: true, force: true });
for (const name of readdirSync(__dirname)) {
  if (/\.ssr\.(?:mjs|css)$/.test(name) || name === "bundles.generated.ts" || name === "artifact-svelte-runtime.generated.ts") {
    rmSync(here(name), { force: true });
  }
}

// ── 1. svelte-hono client artifacts (shared runtime + per-component). ─────
const result = await buildHonoSvelte({
  workerEntry: here("route.ts"),
  outDir: here("build"),
  components: {
    connectors: here("Connectors.svelte"),
    sessions: here("Sessions.svelte"),
    settings: here("Settings.svelte"),
    appshell: here("AppShell.svelte"),
    checkin: here("CheckIn.svelte"),
    chat: here("Chat.svelte"),
    beta: here("BetaApp.svelte"),
  },
  // Module imported by multiple components and holding cross-component
  // $state. Without `sharedModules`, each component would inline its own
  // copy and the stores wouldn't share state across panel boundaries.
  //
  // The specifier MUST be a bare specifier (no leading ./ or /), because
  // import maps only match bare specifiers as-is. Relative specifiers get
  // resolved to absolute URLs first, then looked up by absolute URL.
  sharedModules: {
    "@my-ax/store": here("store.svelte.ts"),
  },
  skipWorkerBundle: true,
});

const pierreOutput = await build({
  entryPoints: [here("pierre-diffs-client.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  write: false,
  logLevel: "silent",
});
const pierreJs = new TextDecoder().decode(pierreOutput.outputFiles[0].contents);
const pierreHash = createHash("sha256").update(pierreJs).digest("hex").slice(0, 8);
writeFileSync(here(`build/pierre-diffs.${pierreHash}.js`), pierreJs);

const hljsOutput = await build({
  entryPoints: [here("hljs-client.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  write: false,
  logLevel: "silent",
  loader: { ".css": "text" },
});
const hljsJs = new TextDecoder().decode(hljsOutput.outputFiles[0].contents);
const hljsHash = createHash("sha256").update(hljsJs).digest("hex").slice(0, 8);
writeFileSync(here(`build/hljs.${hljsHash}.js`), hljsJs);

const bundlesPath = here("bundles.generated.ts");
const generatedBundles = readFileSync(bundlesPath, "utf8");
const bundleEnd = generatedBundles.lastIndexOf("\n};");
if (bundleEnd < 0) throw new Error("Svelte bundle registry was not generated");
writeFileSync(
  bundlesPath,
  `${generatedBundles.slice(0, bundleEnd)},\n  "pierre-diffs": ${JSON.stringify({ js: pierreJs, css: "", hash: pierreHash })},\n  "hljs": ${JSON.stringify({ js: hljsJs, css: "", hash: hljsHash })}\n};\n`,
);

console.log("✓ svelte-hono spike client artifacts");
for (const [id, sz] of Object.entries(result.bundleSizes)) {
  console.log(`    ${id.padEnd(10)}  ${(sz.js / 1024).toFixed(1)} KB JS + ${(sz.css / 1024).toFixed(2)} KB CSS`);
}
console.log(`    pierre-diffs  ${(pierreJs.length / 1024).toFixed(1)} KB JS lazy`);
console.log(`    hljs          ${(hljsJs.length / 1024).toFixed(1)} KB JS lazy`);

// ── 2. Pre-compiled <Name>.ssr.mjs modules for each component, imported ──
// Wrangler's bundler doesn't know how to load .svelte files; we hand it a
// plain .mjs that imports svelte/server.
for (const name of ["Connectors", "Sessions", "Settings", "AppShell", "CheckIn", "Chat", "BetaApp"]) {
  await build({
    entryPoints: [here(`${name}.svelte`)],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    outfile: here(`${name}.ssr.mjs`),
    external: ["svelte", "svelte/server", "svelte/internal/server"],
    minify: false,
    // The browser resolves @my-ax/store via the import map at runtime.
    // For SSR (Node.js), esbuild can't see the import map, so alias the
    // bare specifier to the on-disk module so it inlines into the SSR bundle.
    alias: { "@my-ax/store": here("store.svelte.ts") },
    plugins: [sveltePlugin({
      compilerOptions: { generate: "server", dev: false, css: "external" },
    })],
    logLevel: "silent",
  });
  console.log(`✓ ${name}.ssr.mjs ready for worker import`);
}

const ARTIFACT_SVELTE_SPECS = [
  "svelte",
  "svelte/internal/client",
  "svelte/internal/disclose-version",
  "svelte/reactivity",
  "svelte/store",
  "svelte/transition",
  "svelte/easing",
  "svelte/animate",
  "svelte/motion",
];
const artifactSvelteResult = await build({
  entryPoints: Object.fromEntries(ARTIFACT_SVELTE_SPECS.map((spec, index) => [`e${index}`, spec])),
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  write: false,
  outdir: "/virtual",
  conditions: ["browser", "svelte", "import", "default"],
  logLevel: "silent",
});
const artifactImportMap = {};
const fileMap = new Map(artifactSvelteResult.outputFiles.map((file) => [file.path.replace(/^\/virtual\//, ""), file.text]));
const rewriteChunks = (source) => source.replace(/(["'])\.\/(chunk-[A-Za-z0-9_-]+\.js)\1/g, '$1__myax_svelte_$2$1');
for (const [name, source] of fileMap.entries()) {
  const rewritten = rewriteChunks(source);
  const dataUrl = `data:application/javascript;base64,${Buffer.from(rewritten, "utf8").toString("base64")}`;
  if (name.startsWith("chunk-")) {
    artifactImportMap[`__myax_svelte_${name}`] = dataUrl;
  } else {
    const match = /^e(\d+)\.js$/.exec(name);
    if (match) artifactImportMap[ARTIFACT_SVELTE_SPECS[Number(match[1])]] = dataUrl;
  }
}
writeFileSync(
  here("artifact-svelte-runtime.generated.ts"),
  `export const ARTIFACT_SVELTE_VERSION = ${JSON.stringify(SVELTE_VERSION)};\nexport const ARTIFACT_SVELTE_IMPORT_MAP: Record<string, string> = ${JSON.stringify(artifactImportMap)};\n`,
);
console.log(`✓ artifact-svelte-runtime.generated.ts ready (${Object.keys(artifactImportMap).length} self-hosted modules, svelte@${SVELTE_VERSION})`);
