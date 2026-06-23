// routes/connectors.ts — connector authorization endpoints.
//
//   GET  /api/connectors/:id/authorize       → 302 to provider
//   GET  /api/connectors/:id/callback        → token exchange + 302 to /
//   POST /api/connectors/:id/disconnect

import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { getBuiltinConnectors, type ConnectorId } from "../connectors";
import { oauthStoreFor } from "../oauth-store";
import type { ApiResponse } from "../types";

export function registerConnectorRoutes(app: Hono<AppEnv>) {
  // ── OAuth: /api/connectors/:id/authorize → redirect to provider ──
  app.get("/api/connectors/:id/authorize", async (c) => {
    const connectorId = c.req.param("id");
    const store = oauthStoreFor(c);
    const email = c.get("identity").email;
    // Look up in the merged registry (built-ins + this user's BYO MCPs).
    const userMcps = await store.listUserMcps(email);
    const userMcp = userMcps.find((m) => m.id === connectorId);
    const connector = getBuiltinConnectors(c.env)[connectorId] ?? userMcp;
    if (!connector) {
      return c.json<ApiResponse>(
        {
          ok: false,
          command: c.req.path,
          error: { message: `Unknown connector ${connectorId}`, code: "NOT_FOUND" },
          next_actions: [],
        },
        404,
      );
    }
    if (connector.auth.kind !== "oauth-bearer") {
      return c.json<ApiResponse>(
        {
          ok: false,
          command: c.req.path,
          error: {
            message: `Connector ${connectorId} is not oauth-bearer; no authorization flow`,
            code: "NOT_APPLICABLE",
          },
          next_actions: [],
        },
        400,
      );
    }
    const redirectBackTo = c.req.query("return") ?? "/";
    const { authorizationUrl } = await store.startAuthorization(
      email,
      connectorId,
      redirectBackTo,
    );
    return c.redirect(authorizationUrl, 302);
  });

  // ── OAuth: /api/connectors/:id/callback → exchange code for tokens ──
  //
  // The user lands here after consenting at the upstream provider; we
  // exchange the auth code for tokens (via
  // OAuthClientStore.completeAuthorization), persist them in OAuthClientDO,
  // and redirect back to "/" with a query string the chat page reads as a
  // toast banner.
  app.get("/api/connectors/:id/callback", async (c) => {
    const connectorId = c.req.param("id") as ConnectorId;
    const code = c.req.query("code");
    const state = c.req.query("state");

    // The callback redirects back to "/" with a query string the chat page
    // can read and render as a toast. Plain JSON responses are user-hostile
    // on mobile (you land on a JSON dump after SSO with no way back). The
    // chat page's bootstrap reads ?connector=...&result=... and shows a
    // banner accordingly.
    const goBack = (params: Record<string, string>) => {
      const qs = new URLSearchParams({ connector: connectorId, ...params }).toString();
      return c.redirect(`/?${qs}`, 302);
    };

    if (!code || !state) {
      return goBack({ result: "error", reason: "missing_code_or_state" });
    }
    const store = oauthStoreFor(c);
    const result = await store.completeAuthorization(
      c.get("identity").email,
      connectorId,
      code,
      state,
    );
    if (!result.ok) {
      return goBack({ result: "error", reason: result.error });
    }
    return goBack({ result: "ok" });
  });

  // ── Disconnect: remove stored tokens for a user+connector ──
  app.post("/api/connectors/:id/disconnect", async (c) => {
    const connectorId = c.req.param("id");
    const store = oauthStoreFor(c);
    const email = c.get("identity").email;
    // Accept built-ins OR any of this user's BYO MCPs. We don't need to
    // dereference the connector record for a disconnect — we just clear
    // tokens:<id> in the DO.
    const userMcps = await store.listUserMcps(email);
    const knownIds = new Set<string>([
      ...Object.keys(getBuiltinConnectors(c.env)),
      ...userMcps.map((m) => m.id),
    ]);
    if (!knownIds.has(connectorId)) {
      return c.json<ApiResponse>(
        {
          ok: false,
          command: c.req.path,
          error: { message: `Unknown connector ${connectorId}`, code: "NOT_FOUND" },
          next_actions: [],
        },
        404,
      );
    }

    await store.disconnect(email, connectorId);

    return c.json<ApiResponse>({
      ok: true,
      command: c.req.path,
      result: { connectorId, disconnected: true },
      next_actions: [
        {
          command: `GET /api/connectors/${connectorId}/authorize`,
          description: "Re-authorize this connector",
        },
      ],
    });
  });
}
