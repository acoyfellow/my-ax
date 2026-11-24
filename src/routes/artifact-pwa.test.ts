import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Hono } from "hono";
import { VERSION } from "svelte/compiler";
import type { AppEnv } from "../app-env";
import type { Env } from "../types";
import { artifactMonogram, artifactShortName } from "../artifact-pwa";
import { registerArtifactRoutes } from "./artifacts";

const ID = "123e4567-e89b-12d3-a456-426614174000";
const OWNER = "owner@example.com";

function appFor(title: string, found = true) {
  const manifest = {
    schema: "my-ax.svelte-artifact.v1",
    id: ID,
    kind: "svelte-widget",
    title,
    source: "<div>ok</div>",
    sourceHash: "abc",
    clientJs: "export default function W() {}",
    css: "",
    svelteVersion: VERSION,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const env = {
    USER_UPLOADS: { get: async () => (found ? { json: async () => manifest } : null) },
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () =>
            found
              ? {
                  id: ID,
                  owner_email: OWNER,
                  session_id: "s",
                  kind: "svelte-widget",
                  title,
                  storage_key: "artifacts/k.json",
                  source_hash: "abc",
                  created_at: "2026-01-01T00:00:00.000Z",
                }
              : null,
        }),
      }),
    },
  } as unknown as Env;
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("identity", { email: OWNER, sub: "owner" });
    await next();
  });
  registerArtifactRoutes(app);
  return { request: (path: string) => app.request(`https://my.example.test${path}`, undefined, env) };
}

test("artifact PWA shell keeps the widget inside a sandboxed iframe and links a credentialed manifest", async () => {
  const res = await appFor('Sidebar <script>alert(1)</script>').request(`/apps/${ID}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, new RegExp(`<link rel="manifest" href="/apps/${ID}/manifest\\.webmanifest" crossorigin="use-credentials">`));
  assert.match(html, new RegExp(`<iframe src="/api/artifacts/${ID}/preview"[^>]*sandbox="allow-scripts allow-downloads allow-forms allow-popups allow-popups-to-escape-sandbox"`));
  assert.doesNotMatch(html, /allow-same-origin/);
  assert.doesNotMatch(html, /allow-top-navigation/);
  assert.match(html, /allow="fullscreen; clipboard-write; clipboard-read; screen-wake-lock; web-share; autoplay"/);
  assert.match(html, /my-ax:app-storage/);
  assert.match(html, /my-ax:app-notify/);
  assert.match(html, /my-ax:app-share/);
  assert.match(html, /my-ax:app-env/);
  assert.match(html, /e\.source!==frame\.contentWindow/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /navigator\.serviceWorker\.register\('\/sw\.js'/);
});

test("artifact manifest scopes to the single artifact and includes SVG and PNG icons", async () => {
  const res = await appFor("Daily Habit Tracker Deluxe").request(`/apps/${ID}/manifest.webmanifest`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type") ?? "", /application\/manifest\+json/);
  const data = (await res.json()) as {
    id: string;
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    icons: Array<{ src: string; type: string; sizes: string }>;
  };
  assert.equal(data.id, `/apps/${ID}`);
  assert.equal(data.name, "Daily Habit Tracker Deluxe");
  assert.equal(data.short_name, artifactShortName("Daily Habit Tracker Deluxe"));
  assert.equal(data.start_url, `https://my.example.test/apps/${ID}`);
  assert.equal(data.scope, `https://my.example.test/apps/${ID}`);
  assert.equal(data.display, "standalone");
  assert.ok(data.icons.some((icon) => icon.type === "image/svg+xml" && icon.src.endsWith(`/apps/${ID}/icon.svg`)));
  assert.ok(data.icons.some((icon) => icon.type === "image/png" && icon.sizes === "192x192"));
  assert.ok(data.icons.some((icon) => icon.type === "image/png" && icon.sizes === "512x512"));
});

test("artifact icon SVG renders a clean escaped monogram and missing artifacts return 404", async () => {
  assert.equal(artifactMonogram("Sidebar Playground"), "SP");
  assert.equal(artifactMonogram("Clock"), "CL");
  const iconRes = await appFor("Sidebar Playground").request(`/apps/${ID}/icon.svg`);
  assert.equal(iconRes.status, 200);
  assert.match(iconRes.headers.get("Content-Type") ?? "", /image\/svg\+xml/);
  assert.match(await iconRes.text(), />SP<\/text>/);

  for (const path of [`/apps/${ID}`, `/apps/${ID}/manifest.webmanifest`, `/apps/${ID}/icon.svg`]) {
    const missing = await appFor("Missing", false).request(path);
    assert.equal(missing.status, 404, path);
  }
});

test("/apps/* is gated by Cloudflare Access middleware in src/index.tsx", () => {
  const indexSource = readFileSync(new URL("../index.tsx", import.meta.url), "utf8");
  assert.match(indexSource, /app\.use\("\/apps\/\*", accessMiddleware\(\)\)/);
});
