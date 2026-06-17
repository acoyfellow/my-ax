import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { listOwnedArtifacts, readOwnedSvelteArtifact } from "../artifacts";

function artifactPreview(manifest: { title: string; clientJs: string; css: string }): string {
  const css = manifest.css.replace(/<\/style/gi, "<\\/style");
  const moduleUrl = `data:application/javascript;charset=utf-8,${encodeURIComponent(manifest.clientJs)}`;
  const title = manifest.title.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
  const runtime = "https://esm.sh/svelte@5.55.10";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><script type="importmap">{"imports":{"svelte":"${runtime}","svelte/":"${runtime}/"}}</script><style>html,body{margin:0;padding:0;width:100%;min-height:100%;background:#0a0a0a;color:#e9e9ec;font-family:Inter,ui-sans-serif,system-ui,sans-serif;overflow:auto}body{display:flex;align-items:stretch;justify-content:stretch;min-height:100dvh}#app{width:100%;min-height:100dvh}${css}</style></head><body><div id="app"></div><script type="module">import Component from ${JSON.stringify(moduleUrl)}; import { mount } from "svelte"; mount(Component,{target:document.getElementById("app")});</script></body></html>`;
}

export function registerArtifactRoutes(app: Hono<AppEnv>) {
  // Backend preparation for a future Artifact Library. There is deliberately
  // no library UI yet; this owner-scoped index makes the durable objects
  // observable and proves conversation cleanup.
  app.get("/api/artifacts", async (c) => {
    const raw = Number.parseInt(c.req.query("limit") ?? "100", 10);
    const artifacts = await listOwnedArtifacts(c.env, c.get("identity"), raw);
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { artifacts }, next_actions: [] });
  });

  app.get("/api/artifacts/:id/preview", async (c) => {
    const manifest = await readOwnedSvelteArtifact(c.env, c.get("identity"), c.req.param("id"));
    if (!manifest) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Artifact not found" }, next_actions: [] }, 404);
    return c.html(artifactPreview(manifest), 200, {
      "Cache-Control": "private, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline' data: https://esm.sh; style-src 'unsafe-inline'; connect-src https://esm.sh; img-src data:; font-src 'none'; object-src 'none'; frame-ancestors *; base-uri 'none'; form-action 'none'; navigate-to 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
  });
}
