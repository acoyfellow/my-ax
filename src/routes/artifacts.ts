import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";
import { deleteOwnedArtifact, listOwnedArtifacts, readOwnedSvelteArtifact, renameOwnedArtifact, updateOwnedArtifactSource } from "../artifacts";
import { ARTIFACT_RUNTIME_JS } from "../artifact-runtime";
import { ARTIFACT_THEME_CSS } from "../artifact-theme";
import { artifactPwaIconSvg, artifactPwaShellHtml, artifactWebManifest } from "../artifact-pwa";
import { TILE_BASE_CSS, TILE_RUNTIME_JS } from "../tile-panel";
import { ARTIFACT_SVELTE_IMPORT_MAP, ARTIFACT_SVELTE_VERSION } from "../ui/artifact-svelte-runtime.generated";
import { VERSION as SVELTE_COMPILER_VERSION } from "svelte/compiler";

export const ARTIFACT_SVELTE_RUNTIME = `self-hosted:svelte@${ARTIFACT_SVELTE_VERSION || SVELTE_COMPILER_VERSION}`;

const ARTIFACT_IMPORT_MAP_JSON = JSON.stringify({ imports: ARTIFACT_SVELTE_IMPORT_MAP });

function artifactPreview(manifest: { title: string; clientJs: string; css: string }, options: { inline?: boolean } = {}): string {
  const css = manifest.css.replace(/<\/style/gi, "<\\/style");
  const moduleUrl = `data:application/javascript;charset=utf-8,${encodeURIComponent(manifest.clientJs)}`;
  const title = manifest.title.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="my-ax-svelte-runtime" content="${ARTIFACT_SVELTE_RUNTIME}"><title>${title}</title><script type="importmap">${ARTIFACT_IMPORT_MAP_JSON}</script><style>${ARTIFACT_THEME_CSS}${options.inline ? "html,body{width:100%;overflow:auto}#app{width:100%}" : "html,body{width:100%;min-height:100%;overflow:auto}body{display:flex;align-items:stretch;justify-content:stretch;min-height:100dvh}#app{width:100%;min-height:100dvh}"}${css}</style></head><body><div id="app"></div><script>${ARTIFACT_RUNTIME_JS}</script><script type="module">import Component from ${JSON.stringify(moduleUrl)}; import { mount } from "svelte"; mount(Component,{target:document.getElementById("app")});</script></body></html>`;
}

function tilePreview(manifest: { title: string; clientJs: string; css: string }): string {
  const css = manifest.css.replace(/<\/style/gi, "<\\/style");
  const moduleUrl = `data:application/javascript;charset=utf-8,${encodeURIComponent(manifest.clientJs)}`;
  const title = manifest.title.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="my-ax-svelte-runtime" content="${ARTIFACT_SVELTE_RUNTIME}"><title>${title}</title><script type="importmap">${ARTIFACT_IMPORT_MAP_JSON}</script><style>${TILE_BASE_CSS}${css}</style></head><body><div id="app"></div><script>${TILE_RUNTIME_JS}</script><script type="module">import Component from ${JSON.stringify(moduleUrl)}; import { mount } from "svelte"; mount(Component,{target:document.getElementById("app")});</script></body></html>`;
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
    const body: { title?: string; source?: string } = await c.req.json<{ title?: string; source?: string }>().catch(() => ({}));
    try {
      if (typeof body.source === "string") {
        const updated = await updateOwnedArtifactSource(c.env, c.get("identity"), c.req.param("id"), body.source);
        if (!updated) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Artifact not found" }, next_actions: [] }, 404);
        if (typeof body.title !== "string") return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { updated }, next_actions: [] });
      }
      const renamed = await renameOwnedArtifact(c.env, c.get("identity"), c.req.param("id"), body.title ?? "");
      if (!renamed) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Artifact not found" }, next_actions: [] }, 404);
      return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { renamed: true }, next_actions: [] });
    } catch (error) {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) }, next_actions: [] }, 400);
    }
  });

  app.get("/api/artifacts/:id/source", async (c) => {
    const manifest = await readOwnedSvelteArtifact(c.env, c.get("identity"), c.req.param("id"));
    if (!manifest) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Artifact not found" }, next_actions: [] }, 404);
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { id: manifest.id, title: manifest.title, source: manifest.source }, next_actions: [] });
  });

  app.delete("/api/artifacts/:id", async (c) => {
    const deleted = await deleteOwnedArtifact(c.env, c.get("identity"), c.req.param("id"));
    if (!deleted) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Artifact not found" }, next_actions: [] }, 404);
    return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { deleted: true }, next_actions: [] });
  });

  app.get("/api/artifacts/:id/preview", async (c) => {
    const manifest = await readOwnedSvelteArtifact(c.env, c.get("identity"), c.req.param("id"));
    if (!manifest) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Artifact not found" }, next_actions: [] }, 404);
    const etag = `"${manifest.sourceHash}"`;
    const cacheHeaders = { "Cache-Control": "private, no-cache", ETag: etag };
    if (c.req.header("If-None-Match") === etag) return c.body(null, 304, cacheHeaders);
    const html = c.req.query("tile") === "1" ? tilePreview(manifest) : artifactPreview(manifest, { inline: c.req.query("inline") === "1" });
    return c.html(html, 200, {
      ...cacheHeaders,
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none'; object-src 'none'; frame-ancestors *; base-uri 'none'; form-action 'none'; navigate-to 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
  });

  app.get("/apps/:id/manifest.webmanifest", async (c) => {
    const manifest = await readOwnedSvelteArtifact(c.env, c.get("identity"), c.req.param("id"));
    if (!manifest) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Artifact not found" }, next_actions: [] }, 404);
    const origin = new URL(c.req.url).origin;
    return c.body(JSON.stringify(artifactWebManifest({ id: manifest.id, title: manifest.title, origin })), 200, {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    });
  });

  app.get("/apps/:id/icon.svg", async (c) => {
    const manifest = await readOwnedSvelteArtifact(c.env, c.get("identity"), c.req.param("id"));
    if (!manifest) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Artifact not found" }, next_actions: [] }, 404);
    return c.body(artifactPwaIconSvg(manifest.id, manifest.title), 200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    });
  });

  app.get("/apps/:id", async (c) => {
    const manifest = await readOwnedSvelteArtifact(c.env, c.get("identity"), c.req.param("id"));
    if (!manifest) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "Artifact not found" }, next_actions: [] }, 404);
    const origin = new URL(c.req.url).origin;
    return c.html(artifactPwaShellHtml({ id: manifest.id, title: manifest.title, origin }), 200, {
      "Cache-Control": "private, no-cache",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
  });
}
