// Registers the /__svelte/<id>.<hash>.{js,css} bundle-serving routes the
// browser fetches at runtime to hydrate every component.
//
// Each per-component client bundle, the shared _runtime bundle, and the
// shared store module all live behind these routes. svelte-hono's
// `attachSvelteRoutes` does the actual wiring (content-hash routing,
// 1-year immutable cache headers, ETag, gzip).
//
// Mounted in src/index.tsx via registerSvelteServe(app).

import { attachSvelteRoutes } from "svelte-hono";
import { Hono } from "hono";
import type { AppEnv } from "../../src/app-env";
import { bundles } from "./bundles.generated";

export function registerSvelteServe(app: Hono<AppEnv>) {
  // svelte-hono uses a default Hono<Env> generic that doesn't carry our
  // AppEnv variables. Bridge through a plain Hono instance, mount, then
  // route everything else back to the typed app.
  const plain = new Hono();
  attachSvelteRoutes(plain, { bundles });
  app.route("/", plain);
}
