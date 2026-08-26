import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { deleteOwnedArtifact, listOwnedArtifacts, readOwnedSvelteArtifact, renameOwnedArtifact } from "../artifacts";
import { ARTIFACT_RUNTIME_JS } from "../artifact-runtime";
import { ARTIFACT_THEME_CSS } from "../artifact-theme";

function artifactPreview(manifest: { title: string; clientJs: string; css: string }): string {
  const css = manifest.css.replace(/<\/style/gi, "<\\/style");
  const moduleUrl = `data:application/javascript;charset=utf-8,${encodeURIComponent(manifest.clientJs)}`;
  const title = manifest.title.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
  const runtime = "https://esm.sh/svelte@5.55.10";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><script type="importmap">{"imports":{"svelte":"${runtime}","svelte/":"${runtime}/"}}</script><style>${ARTIFACT_THEME_CSS}html,body{width:100%;min-height:100%;overflow:auto}body{display:flex;align-items:stretch;justify-content:stretch;min-height:100dvh}#app{width:100%;min-height:100dvh}${css}</style></head><body><div id="app"></div><script>${ARTIFACT_RUNTIME_JS}</script><script type="module">import Component from ${JSON.stringify(moduleUrl)}; import { mount } from "svelte"; mount(Component,{target:document.getElementById("app")});</script></body></html>`;
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

  app.patch("/api/artifacts/:id", async (c) => {
    const body: { title?: string } = await c.req.json<{ title?: string }>().catch(() => ({}));
    try {
      const renamed = await renameOwnedArtifact(c.env, c.get("identity"), c.req.param("id"), body.title ?? "");
      if (!renamed) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Artifact not found" }, next_actions: [] }, 404);
      return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { renamed: true }, next_actions: [] });
    } catch (error) {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) }, next_actions: [] }, 400);
    }
  });

  app.delete("/api/artifacts/:id", async (c) => {
    const deleted = await deleteOwnedArtifact(c.env, c.get("identity"), c.req.param("id"));
    if (!deleted) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Artifact not found" }, next_actions: [] }, 404);
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { deleted: true }, next_actions: [] });
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
