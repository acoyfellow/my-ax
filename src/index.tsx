import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { getAgentByName, routeAgentRequest, routeSubAgentRequest } from "agents";
import type { Env, ApiResponse } from "./types";
import { accessMiddleware } from "./auth";
import { handleBridgeRequest } from "./bridge";
import type { ConnectorId } from "./connectors";
import { callableConnectors } from "./connectors";

/**
 * Voice mode (Deepgram Flux STT + Aura-1 TTS via Workers AI) is opt-in
 * because those Workers AI models may be beta-gated on accounts without
 * entitlement. Set VOICE_ENABLED=1 in wrangler.jsonc to enable it.
 */
function isVoiceEnabled(env: Env): boolean {
  return String((env as unknown as Record<string, unknown>).VOICE_ENABLED ?? "") === "1";
}
import { getUserWorkspace } from "./workspace";
import { BetaPage } from "./views/BetaPage";
import type { AppEnv } from "./app-env";
import { deploymentVersionResponse } from "./deploy-version";
import { oauthStoreFor } from "./oauth-store";
import { readThemeCookie } from "./routes/theme";
import { registerSessionRoutes } from "./routes/sessions";
import { resolveOwnedVoiceTarget } from "./voice-session-ownership";
import { registerUploadRoutes } from "./routes/uploads";
import { registerPushRoutes } from "./routes/push";
import { registerJobRoutes } from "./routes/jobs";
import { registerMcpRoutes } from "./routes/mcp";
import { registerBrowserRoutes } from "./routes/browser";
import { registerAttentionRoutes } from "./routes/attention";
import { registerCheckInRoutes } from "./routes/check-in";
import { registerSystemRoutes } from "./routes/system";
import { registerModelRoutes } from "./routes/models";
import { registerConnectorRoutes } from "./routes/connectors";
import { registerMcpsCrudRoutes } from "./routes/mcps";
import { registerThemeRoutes } from "./routes/theme";
import { registerStarterRoutes } from "./routes/starters";
import { registerMachinectlRoutes } from "./routes/machinectl";
import { registerRunRoutes } from "./routes/runs";
import { registerArtifactRoutes } from "./routes/artifacts";
import { registerDecisionRoutes } from "./routes/decisions";
import { registerCapabilityRoutes } from "./routes/capabilities";
import { registerRecipeRoutes } from "./routes/recipes";
import { registerCostSeriesRoutes } from "./routes/cost-series";
import { CapabilitiesPage } from "./views/CapabilitiesPage";
import { DocsPage } from "./views/DocsPage";
import { DocsArticlePage } from "./views/DocsArticlePage";
import { DOC_PAGE_BY_SLUG } from "./docs-content.generated";
import { getSessionAgent } from "./agent-stub";
import { registerSvelteServe } from "../proof/svelte/serve";
import { scanDeadSessions } from "./dead-session";

// Re-export Durable Object classes (required by wrangler).
// Sandbox comes from @cloudflare/sandbox and pairs with the `containers`
// block + `Sandbox` SQLite class migration in wrangler.jsonc.

export { MyAgent } from "./agent";
export { ReadOnlyDelegateAgent } from "./delegate-many";
export { VoiceThinkAgent } from "./voice-think-agent";
export { UserAgent } from "./user-agent";
export { OAuthClientDO } from "./oauth-store";
export { MachineHost } from "./machinectl-host";
export { Sandbox } from "@cloudflare/sandbox";
// Native @cloudflare/codemode runtime Durable Object class.
//
// HELD: the DO binding + v11 migration are intentionally NOT declared in
// wrangler.jsonc yet because no call site in this worker drives
// `runNativeCodemode` against a real DurableObjectState handle. Round 04
// review flagged premature wiring as a forward-only DO migration for
// dead code. The class itself is kept available behind
// `code-mode-runtime.worker.ts` so the future cutover only needs to:
//   1. uncomment the export below,
//   2. add the binding + `v11-codemode-runtime` migration to wrangler.jsonc,
//   3. regenerate worker-configuration.d.ts via `wrangler types`,
//   4. add the first real `runNativeCodemode` call site.
// Until that change lands, the projected/synthetic snippet seam in
// `cm-snippets.ts` remains the honest surface.
// export { CodemodeRuntime } from "./code-mode-runtime.worker";

const app = new Hono<AppEnv>();

// Fail loud on missing CORE secrets only. The two below are required for the
// worker's own crypto (bridge tickets + at-rest encryption). Everything else
// is feature-gated and validated at the call site, so a minimal deploy boots:
//   - Models: Workers AI rows need env.AI. Gateway rows need the configured
//     LLM gateway token.
//   - Web Push (notify_owner): needs VAPID_* — only when you use push.
//   - Workspace snapshots: need R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY — only
//     when the Sandbox createBackup path runs.
// This lets a fresh self-host deploy start on Workers AI with just the two
// core secrets; add the others as you enable those features.
const REQUIRED_SECRETS = [
  "BRIDGE_JWT_SECRET",
  "MASTER_KEY",
] as const satisfies ReadonlyArray<keyof Env>;

function missingSecrets(env: Env): string[] {
  return REQUIRED_SECRETS.filter((k) => {
    const v = (env as unknown as Record<string, unknown>)[k];
    return typeof v !== "string" || v.length === 0;
  });
}

function isMachinectlPath(path: string): boolean {
  return path === "/machinectl/connect" || path === "/machinectl/mcp" || path === "/api/machinectl/status" || path === "/api/machinectl/call" || path === "/api/machinectl/observations/session";
}

app.use("*", async (c, next) => {
  const missing = missingSecrets(c.env);
  // Physical-laptop relay only needs Access + MACHINE_HOST + AUDIT_KV. It
  // should stay testable/usable even when unrelated chat/sandbox secrets are
  // absent in a minimal local dev environment.
  if (missing.length && !isMachinectlPath(c.req.path)) {
    return c.json<ApiResponse>({
      ok: false,
      command: c.req.path,
      error: {
        code: "MISSING_SECRETS",
        message: `Worker secrets not configured: ${missing.join(", ")}`,
      },
      next_actions: [],
    }, 500);
  }
  await next();
});

app.use("*", cors());

// GET /api/health — identity-free liveness/wiring probe for the my-ax-smoke-prober
// service token (and any future external monitoring). Mounted before the
// accessMiddleware below so it does NOT require an email claim. Cloudflare
// Access still gates reachability at the edge — only requests that pass the
// Access app's Service Auth policy reach this handler.
//
// Returns: HTTP 200 + JSON envelope that names the bindings present, the
// worker version, and the colo. Never includes secret values or user data.
app.get("/api/health", async (c) => {
  const env = c.env;
  const cf = (c.req.raw as Request & { cf?: { colo?: string } }).cf;
  const version = env.CF_VERSION_METADATA?.id ?? null;
  const requiredSecretsMissing = missingSecrets(env);
  const bindings = {
    USER_AGENT: Boolean(env.USER_AGENT),
    OAUTH_CLIENT: Boolean(env.OAUTH_CLIENT),
    MACHINE_HOST: Boolean(env.MACHINE_HOST),
    SANDBOX: Boolean(env.SANDBOX),
    DB: Boolean(env.DB),
    AUDIT_KV: Boolean(env.AUDIT_KV),
    BACKUP_BUCKET: Boolean(env.BACKUP_BUCKET),
    USER_UPLOADS: Boolean(env.USER_UPLOADS),
    AI: Boolean(env.AI),
    BROWSER: Boolean(env.BROWSER),
    LOADER: Boolean(env.LOADER),
  };
  const checks = {
    d1Schema: await env.DB.prepare("SELECT 1 FROM sessions LIMIT 1").first().then(() => true).catch(() => false),
    browserOwnershipSchema: await env.DB.prepare("SELECT 1 FROM browser_recordings LIMIT 1").first().then(() => true).catch(() => false),
  };
  const ok = (env.ENVIRONMENT === "dev" || requiredSecretsMissing.length === 0) && Object.values(bindings).every(Boolean) && Object.values(checks).every(Boolean);
  return c.json({
    ok,
    name: "my-ax",
    version,
    region: cf?.colo ?? null,
    bindings,
    checks,
    requiredSecretsMissing,
    now: new Date().toISOString(),
  }, ok ? 200 : 500);
});

// Cloudflare Access in front of EVERYTHING that matters.
app.use("/api/*", accessMiddleware());
app.use("/agents/*", accessMiddleware());
app.use("/bridge/*", accessMiddleware());
app.use("/machinectl/*", accessMiddleware());
// The chat page renders server-side JSX with the identity baked into the
// header. Gating it means the email pill shows
// immediately on first paint instead of after a /api fetch round-trip.
// Static asset routes (/static/*, /favicon.ico, /sw.js) and the deliberately
// non-personalized /offline fallback stay anonymous so install metadata,
// browser JS, and offline recovery don't have to re-auth on every fetch.
app.use("/", accessMiddleware());
app.use("/beta", accessMiddleware());
// Gate BOTH the base rendered path and every rendered subroute (e.g.
// POST /attention/seen). In Hono, app.use("/attention", ...) alone only
// matches the exact path, so mutating subroutes silently bypassed the
// Access identity middleware and reached owner()/DB with no verified
// caller. See routes/attention.test.ts regressions.
app.use("/attention", accessMiddleware());
app.use("/attention/*", accessMiddleware());
app.use("/runs/*", accessMiddleware());
app.use("/runs", accessMiddleware());
app.use("/jobs", accessMiddleware());
app.use("/capabilities", accessMiddleware());

// ─── Health / discovery ────────────────────────────────────────────────────
// Bodyless, storage-free probe for open clients. Version Metadata makes this
// cheaper than /api/health, which intentionally performs schema checks.
app.get("/api/version", (c) => deploymentVersionResponse(
  c.env.CF_VERSION_METADATA,
  c.req.header("If-None-Match"),
));

app.get("/api", async (c) => {
  try {
  // Show connector authorization status to the user. Built-ins + this
  // user's BYO MCPs are both surfaced; UI uses the `userAdded` flag to
  // render the delete affordance only on the user-added rows.
  const store = oauthStoreFor(c);
  const email = c.get("identity").email;
  const connectorStatus: Record<string, unknown> = {};
  const userMcps = await store.listUserMcps(email);
  const allEntries: Array<[string, { userAdded?: boolean }]> = [
    ...Object.entries(callableConnectors(c.env)),
    ...userMcps.map((m) => [m.id, m] as [string, { userAdded?: boolean }]),
  ];
  for (const [id, def] of allEntries) {
    const tok = await store.getValidAccessToken(email, id as ConnectorId);
    const authorized = tok !== null;
    connectorStatus[id] = {
      kind: "oauth-bearer",
      authorized,
      authorize_url: authorized ? null : `/api/connectors/${id}/authorize`,
      path: authorized ? "per-user-oauth" : "none",
      userAdded: !!def.userAdded,
    };
  }

  const machineHost = c.env.MACHINE_HOST.get(c.env.MACHINE_HOST.idFromName(email.toLowerCase()));
  const machineStatus = await machineHost.fetch("http://internal/status").then((r) => r.json<{ connected?: boolean; machineName?: string | null; tools?: unknown[] }>()).catch(() => ({ connected: false, machineName: null, tools: [] }));
  connectorStatus.machinectl = {
    kind: "access-session",
    authorized: true,
    connected: !!machineStatus.connected,
    machineName: machineStatus.machineName ?? null,
    tools: Array.isArray(machineStatus.tools) ? machineStatus.tools.length : 0,
    authorize_url: null,
    path: "cloudflare-access",
    userAdded: false,
  };

  return c.json<ApiResponse>({
    ok: true,
    command: "my-agent",
    result: {
      name: "My Agent Experience",
      version: "0.0.1",
      identity: c.get("identity").email,
      connectors: connectorStatus,
      endpoints: {
        ws: "/agents/my-agent/:name",
        sessions: "/api/sessions",
        ticket: "/api/sessions/:id/ticket",
        inject: "/api/sessions/:id/inject",
        bridge: "/bridge/:connectorId/*",
        connector_authorize: "/api/connectors/:id/authorize",
        connector_callback: "/api/connectors/:id/callback",
        machinectl_mcp: "/machinectl/mcp",
        machinectl_connect: "/machinectl/connect",
        machinectl_observe_session: "/api/machinectl/observations/session",
      },
    },
    next_actions: [
      { command: "POST /api/sessions", description: "Create a session" },
      { command: "GET /api/mcps", description: "List the MCP servers you've added" },
    ],
  });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json<ApiResponse>({
      ok: false,
      command: "my-agent",
      error: { code: "CONNECTOR_STATUS_UNAVAILABLE", message: `Connector status unavailable: ${message}` },
      next_actions: [{ command: "GET /api", description: "Retry connector status loading" }],
    }, 503);
  }
});

registerSessionRoutes(app);
registerUploadRoutes(app);
registerPushRoutes(app);
registerJobRoutes(app);
registerMcpRoutes(app);
registerBrowserRoutes(app);
registerAttentionRoutes(app);
registerCheckInRoutes(app);
registerSystemRoutes(app);
registerModelRoutes(app);
registerConnectorRoutes(app);
registerMcpsCrudRoutes(app);
registerThemeRoutes(app);
registerStarterRoutes(app);
registerMachinectlRoutes(app);
registerRunRoutes(app);
registerRecipeRoutes(app);
registerCostSeriesRoutes(app);
registerArtifactRoutes(app);
registerDecisionRoutes(app);
registerCapabilityRoutes(app);
registerSvelteServe(app);

// ─── System / workspace container info ─────────────────────────────────────
// Surfaces the equivalent of macOS "About This Mac" for the per-user
// sandbox: disk usage of /home/user (R2-backed), file count, container
// resources, worker version, region, etc. The Settings drawer renders
// this as a small section so users get an at-a-glance sense of their
// cloud machine.
//
// Most numbers come from `sandbox.exec` against the user's container.
// Calls run with short timeouts so a sluggish container doesn't hang
// the drawer; on timeout we report what we have and mark the rest null.
app.get("/api/system", async (c) => {
  const identity = c.get("identity");
  const cf = (c.req.raw as { cf?: IncomingRequestCfProperties }).cf;
  const sys: Record<string, unknown> = {
    identity: identity.email,
    region: cf?.colo ?? null,
    country: cf?.country ?? null,
    // Container spec is hardcoded — matches wrangler.jsonc instance_type.
    // If we change instance_type, bump this. We could fetch from the
    // Cloudflare API but it'd require an account-scope token and isn't
    // worth the round trip for a static value.
    container: {
      instanceType: "standard-4",
      vcpus: 4,
      memoryGiB: 12,
      storageGB: 20,
      image: "cloudflare/sandbox:0.12.1",
    },
    worker: {
      // Cloudflare's Version Metadata binding gives us {id, tag, timestamp}
      // auto-populated on every deploy. Surfaced as "Worker version" in
      // the Settings drawer's About panel.
      versionId: c.env.CF_VERSION_METADATA?.id ?? null,
      versionTimestamp: c.env.CF_VERSION_METADATA?.timestamp ?? null,
      environment: c.env.ENVIRONMENT ?? null,
    },
    storage: {
      bucket: "my-ax-homes",
      prefix: `/${identity.email.toLowerCase()}/`,
    },
    home: null as unknown,
  };

  // Per-user shell numbers: disk usage, file count. Short timeout so the
  // drawer doesn't hang on a cold-starting container.
  try {
    const handle = await getUserWorkspace(c.env, identity);
    // Run two cheap queries concurrently. `du -sb` is bytes; `find ... | wc -l`
    // counts files. Both should finish in well under 1s on a warm sandbox.
    const [duRes, findRes] = await Promise.allSettled([
      handle.sandbox.exec(`du -sb ${handle.home} 2>/dev/null | head -1`, {
        timeout: 4_000,
      }),
      handle.sandbox.exec(
        `find ${handle.home} -type f 2>/dev/null | wc -l`,
        { timeout: 4_000 },
      ),
    ]);

    const duBytes =
      duRes.status === "fulfilled" && duRes.value.exitCode === 0
        ? parseInt((duRes.value.stdout || "").trim().split(/\s+/)[0], 10) || null
        : null;
    const fileCount =
      findRes.status === "fulfilled" && findRes.value.exitCode === 0
        ? parseInt((findRes.value.stdout || "").trim(), 10) || 0
        : null;

    sys.home = {
      path: handle.home,
      diskUsedBytes: duBytes,
      fileCount,
    };
  } catch (err) {
    // Container cold-start can be slow; surface the error but don't 500.
    sys.home = {
      path: "/home/user",
      diskUsedBytes: null,
      fileCount: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return c.json<ApiResponse>({
    ok: true,
    command: "GET /api/system",
    result: sys,
    next_actions: [],
  });
});

// ─── Bridge endpoint ───────────────────────────────────────────────────────
app.all("/bridge/:connectorId/*", async (c) => {
  const connectorId = c.req.param("connectorId");
  const url = new URL(c.req.url);
  const upstreamPath = url.pathname.replace(`/bridge/${connectorId}`, "") || "/";
  return handleBridgeRequest(
    c.req.raw,
    c.env,
    c.get("identity"),
    connectorId,
    upstreamPath + url.search,
    oauthStoreFor(c),
  );
});

// ─── Catch-all: agents SDK WS routing ──────────────────────────────────────
app.all("/agents/*", async (c) => {
  // Preserve the public /agents/my-agent/:sessionId URL while routing the
  // conversation into a MyAgent facet inside one per-user UserAgent root.
  // This makes user-scoped state physically co-located without changing the
  // browser protocol.
  const match = /^\/agents\/my-agent\/([^/]+)$/.exec(c.req.path);
  if (match) {
    const identity = c.get("identity");
    const sessionId = decodeURIComponent(match[1]);
    const ownedSession = await c.env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ?").bind(sessionId, identity.email.toLowerCase()).first<{ id: string }>();
    if (!ownedSession) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "Session not found or not owned" } }, 404);
    const parent = await getAgentByName(c.env.USER_AGENT, identity.email.toLowerCase());
    // Empty facets import the legacy direct-DO transcript before opening the
    // socket so migration-era D1 rows never render a silent blank session.
    try {
      const facet = await getSessionAgent(c.env, identity.email, sessionId);
      await facet.seedIdentity(identity);
      if ((await facet.getMessages()).length === 0) {
        const legacy = c.env.LEGACY_MY_AGENT.get(c.env.LEGACY_MY_AGENT.idFromName(sessionId));
        let messages: import("ai").UIMessage[] = [];
        try {
          messages = await (legacy as unknown as { getMessages: () => Promise<import("ai").UIMessage[]> }).getMessages();
        } catch {}
        // The D1 transcript mirror is the fallback when a legacy direct DO is
        // unavailable, preserving readable history during migration.
        if (!messages.length) {
          const rows = await c.env.DB.prepare(
            "SELECT id, ts, role, content, meta_json FROM conversation_entries WHERE session_id = ? AND owner_email = ? ORDER BY id ASC",
          ).bind(sessionId, identity.email.toLowerCase()).all<{ id: number; ts: string; role: string; content: string; meta_json: string | null }>();
          messages = (rows.results ?? []).map((row) => {
            // Canonical id: MUST match the client's d1EntryToMessage keying
            // (meta.uiMessageId || `d1-<id>`), so the D1 REST read and this Think
            // replay dedup to the same message instead of double-rendering.
            let uiMessageId: string | undefined;
            try { uiMessageId = row.meta_json ? (JSON.parse(row.meta_json)?.uiMessageId as string | undefined) : undefined; } catch {}
            return {
              id: uiMessageId || `d1-${row.id}`,
              role: ["user", "assistant", "system"].includes(row.role) ? row.role as "user" | "assistant" | "system" : "system",
              parts: [{ type: "text", text: row.role === "tool" ? `[tool result]\n${row.content}` : row.content }],
              createdAt: new Date(row.ts),
            };
          });
        }
        if (messages.length) await facet.importLegacyMessages(messages);
      }
    } catch (err) {
      console.error("legacy_session_import_failed", { sessionId, err: err instanceof Error ? err.message : String(err) });
    }
    // Voice mode connects to this SAME route (agent: "my-agent") with the same
    // session id, so the spoken turn shares this DO's Think transcript.
    return routeSubAgentRequest(c.req.raw, parent, { fromPath: `/sub/my-agent/${sessionId}` });
  }

  // Voice runs on its OWN direct-routed DO (not a facet): the stock
  // @cloudflare/voice call lifecycle does not survive the sub-agent WS bridge.
  // Seed it with the owner identity + target session id, then route via stock
  // routeAgentRequest. It delegates each turn back into the MyAgent facet by
  // RPC. See src/voice-think-agent.ts + the direct-routed voice agent in src/voice-think-agent.ts.
  //
  // Voice is env-gated (Deepgram Flux/Aura via Workers AI). Public OSS
  // clones without VOICE_ENABLED=1 get a 404 here so a misconfigured
  // deploy doesn't seed a voice DO that will fail on first audio frame.
  const voiceMatch = /^\/agents\/voice-think-agent\/([^/]+)$/.exec(c.req.path);
  if (voiceMatch) {
    if (!isVoiceEnabled(c.env)) {
      return c.text("voice disabled", 404);
    }
    const identity = c.get("identity");
    const sessionId = decodeURIComponent(voiceMatch[1]);
    try {
      // Resolve ownership and the direct actor name in one fail-closed step.
      const voiceName = await resolveOwnedVoiceTarget(c.env.DB, identity, sessionId);
      const stub = await getAgentByName(c.env.VoiceThinkAgent, voiceName);
      await stub.seedSession(identity, sessionId);
      const routedUrl = new URL(c.req.url);
      // CRITICAL: route with the RAW voiceName, not encodeURIComponent(voiceName).
      // routeAgentRequest/routePartykitRequest resolve the target DO with
      // idFromName(rawPathSegment) WITHOUT decoding it. Percent-encoding the
      // "email:sessionId" name here routed the socket to idFromName("email%3A…")
      // — a DIFFERENT DO than the idFromName("email:sessionId") instance we just
      // seeded — so every turn saw empty state and the "%3A" name also broke the
      // parseVoiceThinkAgentName fallback (no literal ':'), yielding
      // "Voice session is not linked to a conversation yet." The ':' and '@' in
      // voiceName are valid, unencoded path-segment characters preserved by the
      // URL.pathname setter, so the routed DO now matches the seeded one and the
      // name-parse fallback works as defense-in-depth.
      routedUrl.pathname = `/agents/voice-think-agent/${voiceName}`;
      const routedRequest = new Request(routedUrl, c.req.raw);
      return (await routeAgentRequest(routedRequest, c.env)) ?? c.text("voice route not found", 404);
    } catch (err) {
      console.error("voice_session_seed_failed", { sessionId, err: err instanceof Error ? err.message : String(err) });
      return c.json({ ok: false, error: { code: "NOT_FOUND", message: "Session not found or not owned" } }, 404);
    }
  }

  return c.json<ApiResponse>(
    {
      ok: false,
      command: c.req.path,
      error: { message: "Agent route not found", code: "NOT_FOUND" },
      fix: "Connect to /agents/my-agent/:sessionId via WebSocket",
      next_actions: [{ command: "GET /api", description: "See available endpoints" }],
    },
    404,
  );
});

// Pages render JSX server-side via Hono's html() helper.
// Identity is baked into the header pill from the verified Access JWT so
// the user sees their email immediately on first paint. Browser-side JS
// modules live under /static/*.
// Root now serves the single-root BetaApp frontend (promoted from /beta after
// proven 1:1 parity). The legacy 6-mount ChatPage is retired. /beta stays as a
// one-release alias so stale bookmarks / PWA caches still resolve.
const renderApp = (c: Context<AppEnv>) => {
  const identity = c.get("identity");
  const buildId = c.env.CF_VERSION_METADATA?.id ?? undefined;
  const theme = readThemeCookie(c);
  return c.html(
    <BetaPage
      identityEmail={identity?.email ?? null}
      buildId={buildId}
      buildTimestamp={c.env.CF_VERSION_METADATA?.timestamp ?? undefined}
      theme={theme}
      appOrigin={c.env.BRIDGE_BASE_URL || new URL(c.req.url).origin}
    />,
  );
};

app.get("/", (c) => renderApp(c));

// /beta — one-release alias of / during cutover. Remove in a later release.
app.get("/beta", (c) => renderApp(c));

app.get("/capabilities", (c) => {
  const identity = c.get("identity");
  const buildId = c.env.CF_VERSION_METADATA?.id ?? undefined;
  const theme = readThemeCookie(c);
  return c.html(
    <CapabilitiesPage
      identityEmail={identity?.email ?? null}
      buildId={buildId}
      theme={theme}
      appOrigin={c.env.BRIDGE_BASE_URL || new URL(c.req.url).origin}
    />,
  );
});
app.get("/docs", (c) => {
  const identity = c.get("identity");
  const buildId = c.env.CF_VERSION_METADATA?.id ?? undefined;
  const theme = readThemeCookie(c);
  return c.html(
    <DocsPage
      identityEmail={identity?.email ?? null}
      buildId={buildId}
      theme={theme}
      appOrigin={c.env.BRIDGE_BASE_URL || new URL(c.req.url).origin}
    />,
  );
});
app.get("/docs/:slug", (c) => {
  const page = DOC_PAGE_BY_SLUG[c.req.param("slug")];
  if (!page) return c.notFound();
  const identity = c.get("identity");
  const buildId = c.env.CF_VERSION_METADATA?.id ?? undefined;
  const theme = readThemeCookie(c);
  return c.html(
    <DocsArticlePage
      page={page}
      identityEmail={identity?.email ?? null}
      buildId={buildId}
      theme={theme}
      appOrigin={c.env.BRIDGE_BASE_URL || new URL(c.req.url).origin}
    />,
  );
});
// A non-personalized document fallback the service worker can cache. It is
// intentionally outside Access: when a previously-opened installed PWA goes
// offline, the browser needs a safe same-origin HTML response to render.
app.get("/offline", (c) => c.html(
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
      <meta name="theme-color" content="#0a0a0a" />
      <title>Offline · My Agent Experience</title>
      <style dangerouslySetInnerHTML={{ __html: `
        :root { color-scheme: dark; }
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px; background: #0a0a0a; color: #e9e9ec; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        main { width: min(32rem, 100%); padding: 28px; border: 1px solid #27272a; border-radius: 20px; background: #111113; }
        p { color: #b4b4ba; line-height: 1.55; }
        a { display: inline-block; margin-top: 8px; padding: 10px 14px; border-radius: 999px; background: #f6821f; color: #0a0a0a; font-weight: 700; text-decoration: none; }
      ` }} />
    </head>
    <body>
      <main>
        <h1>my · ax is offline</h1>
        <p>The app shell is installed, but chat and Access authentication need a network connection. Reconnect, then try again.</p>
        <a href="/">Try my · ax again</a>
      </main>
    </body>
  </html>
));

// Static assets — anonymous, served straight from /public via the ASSETS
// binding. /sw.js must live at root scope so it can control the installed PWA.
app.get("/static/*", async (c) => c.env.ASSETS.fetch(c.req.raw));
app.get("/favicon.ico", async (c) => c.env.ASSETS.fetch(c.req.raw));
// The service worker script must NEVER be cached by the browser/PWA, or an
// installed iOS PWA keeps running an old SW across app restarts and never picks
// up a deploy (the classic "closed & reopened 10x, still stale" trap). Force
// revalidation so every load re-fetches sw.js; the byte-diff on deploy then
// triggers the update -> skipWaiting -> claim flow and purges the old cache.
app.get("/sw.js", async (c) => {
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  const headers = new Headers(asset.headers);
  headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  headers.set("Service-Worker-Allowed", "/");
  return new Response(asset.body, { status: asset.status, headers });
});

app.notFound((c) =>
  c.json<ApiResponse>(
    {
      ok: false,
      command: c.req.path,
      error: { message: "Not found", code: "NOT_FOUND" },
      fix: "Check available endpoints at GET /api",
      next_actions: [{ command: "GET /api", description: "See available endpoints" }],
    },
    404,
  ),
);

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scanDeadSessions(env));
  },
};
