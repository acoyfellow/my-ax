// Embed a Svelte SSR component inside an existing Hono JSX page.
//
// Pattern:
//   1. The chat page (or any JSX page) calls svelteImportMap() once in <head>
//      and includes <link rel="modulepreload" href="/__svelte/_runtime.<hash>.js">.
//   2. Each port replaces a panel-shaped JSX block with `embedSvelte(...)` and
//      drops the returned HTML in via {raw(html)} + appends the script.
//
// This is svelte-hono's pattern, lifted into a my-ax-local helper because
// our shell HTML is owned by Hono JSX rather than the svelteRenderer's
// built-in shell. We reuse svelte-hono's bundles registry + URLs.

import { render as svelteRender } from "svelte/server";
import { bundles } from "./bundles.generated";

const MOUNT_PREFIX = "/__svelte";
const RUNTIME_ID = "_runtime";
const SHARED_MANIFEST_ID = "_shared_manifest";

function withBuildId(url: string, buildId?: string): string {
  return buildId ? `${url}?v=${encodeURIComponent(buildId)}` : url;
}

function assetUrl(id: string, ext: "js" | "css"): string {
  const b = bundles[id];
  const base = b?.hash ? `${id}.${b.hash}` : id;
  return `${MOUNT_PREFIX}/${base}.${ext}`;
}

function runtimeUrl(): string | null {
  if (!bundles[RUNTIME_ID]) return null;
  return assetUrl(RUNTIME_ID, "js");
}

/** Read the shared-modules manifest emitted by svelte-hono/build. Returns
 *  a map of import specifier (eg. "./store.svelte") to bundle id (eg.
 *  "_shared_store_svelte_ts"). Empty when no sharedModules were declared. */
function sharedManifest(): Record<string, string> {
  const b = bundles[SHARED_MANIFEST_ID];
  if (!b) return {};
  const m = b.js.match(/export default (\{[^}]*\});/);
  if (!m) return {};
  try {
    return JSON.parse(m[1]);
  } catch {
    return {};
  }
}

/** Inline tags that must appear once in <head> for any page hosting embeds.
 *  Returns the markup as a string (Hono JSX uses {raw(...)} to drop it in). */
export function svelteHeadTags(buildId?: string): string {
  const rawRuntime = runtimeUrl();
  const runtime = rawRuntime ? withBuildId(rawRuntime, buildId) : null;
  if (!runtime) return "";
  const manifest = sharedManifest();
  const sharedEntries: Record<string, string> = {};
  for (const [specifier, bundleId] of Object.entries(manifest)) {
    if (!bundles[bundleId]) continue;
    sharedEntries[specifier] = withBuildId(assetUrl(bundleId, "js"), buildId);
  }
  const importMap = JSON.stringify({
    imports: {
      svelte: runtime,
      "svelte/internal/client": runtime,
      "svelte/internal/disclose-version": runtime,
      ...sharedEntries,
    },
  });
  const sharedPreloads = Object.values(sharedEntries)
    .map((url) => `<link rel="modulepreload" href="${url}">`)
    .join("\n");
  return [
    `<script type="importmap">${importMap}</script>`,
    `<link rel="modulepreload" href="${runtime}">`,
    sharedPreloads,
  ]
    .filter(Boolean)
    .join("\n");
}

interface EmbedResult {
  /** SSR'd component HTML wrapped in the hydration target div. Drop in via dangerouslySetInnerHTML. */
  html: string;
  /** Inline <script type=module> that imports the component bundle and hydrates. */
  script: string;
  /** Optional <link> tag for the component's scoped CSS, if it has any. */
  cssLink: string;
  /** Bare URL for the scoped CSS, or null. */
  cssUrl: string | null;
  /** The body of the hydration script (without <script> wrapper) for JSX consumers. */
  scriptBody: string;
}

/**
 * SSR-render a Svelte component and produce the markup needed to embed it
 * inside an existing Hono JSX page.
 *
 * `hydrateAs` must match the bundles.generated.ts entry for this component
 * (set in proof/svelte/build.mjs `components: { health: "..." }`).
 *
 * Each embed gets its own mount target id (`svelte-hono-{hydrateAs}-root`)
 * so multiple components can coexist on the same page without colliding.
 */
export function embedSvelte<Props extends Record<string, unknown> = Record<string, unknown>>(
  component: unknown,
  hydrateAs: string,
  props: Props = {} as Props,
  buildId?: string,
): EmbedResult {
  if (!bundles[hydrateAs]) {
    throw new Error(`embedSvelte: no bundle registered for "${hydrateAs}". ` +
      `Add it to proof/svelte/build.mjs components map.`);
  }

  const out = svelteRender(component as never, { props: props as never });
  const mountId = `svelte-hono-${hydrateAs}-root`;
  const jsUrl = withBuildId(assetUrl(hydrateAs, "js"), buildId);
  const propsJson = JSON.stringify(props);

  const html = `<div id="${mountId}" data-svelte-hono-mount="${hydrateAs}">${out.body}</div>`;

  // Per-embed hydration script. Loads the component bundle and mounts it
  // against this specific mount id. Each embed is independent: if one fails,
  // the others still hydrate.
  const script = `<script type="module">
import { hydrate } from "${jsUrl}";
hydrate(${propsJson}, document.getElementById("${mountId}"));
</script>`;

  const cssBytes = bundles[hydrateAs]?.css?.length ?? 0;
  const cssUrl = cssBytes > 0 ? withBuildId(assetUrl(hydrateAs, "css"), buildId) : null;
  const cssLink = cssUrl ? `<link rel="stylesheet" href="${cssUrl}">` : "";
  const scriptBody = script.replace(/^<script[^>]*>|<\/script>$/g, "");

  return { html, script, cssLink, cssUrl, scriptBody };
}
