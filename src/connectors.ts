// connectors.ts — connector registry (public/self-host engine)
//
// Single auth family today: oauth-bearer (RFC 9728 Managed OAuth). The
// user does the OAuth dance once via browser; the deployed Worker stores
// access+refresh tokens per user in OAuthClientDO, refreshes proactively,
// and attaches as bearer per call. Pattern reference:
//   https://blog.cloudflare.com/managed-oauth-for-access/
//
// Built-in registry: EMPTY. The public engine ships no curated
// connectors. Users add their own MCP servers via Settings → Connectors
// (the BYO MCP path: /api/mcps + OAuthClientDO.listUserMcps). On first
// request, the agent discovers tools via the MCP server's tools/list.

import type { AccessIdentity } from "./auth";
import type { Env } from "./types";

/** Opaque connector identifier. User-added MCP IDs are slugs derived from
 *  the upstream URL on insert. Kept as a type alias rather than a union so
 *  adding a BYO MCP doesn't require recompilation. */
export type ConnectorId = string;

export type ConnectorAuth = {
  kind: "oauth-bearer";
  // OAuth 2.0 endpoints (RFC 8414 well-known discovery told us these).
  authorizationEndpoint: string;
  tokenEndpoint: string;
  // RFC 8707 resource indicator.
  resource: string;
  // Per-user OAuth client. May be a seed value when the connector
  // supports Dynamic Client Registration (RFC 7591) — oauth-store.ts
  // will DCR a fresh client_id on first authorize and persist it.
  clientId: string;
  // RFC 7591 Dynamic Client Registration endpoint, discovered via
  // /.well-known/oauth-authorization-server. Populated for user-added
  // MCPs whose auth server advertises one; null/undefined otherwise.
  registrationEndpoint?: string;
};

// "shape" describes the upstream protocol. Native agent MCP registration uses
// streamable HTTP for "mcp" connectors; "http" is retained for compatible
// deploy-owned REST connectors.
export type ConnectorShape = "mcp" | "http";

export interface Connector {
  id: ConnectorId;
  upstream: string;
  description: string;
  auth: ConnectorAuth;
  shape: ConnectorShape;
  // Optional metadata for BYO (user-added) MCPs. Absent / false on built-
  // in static entries. Used by the UI to render an "added by you" badge
  // and a delete affordance, and by /api/mcps to know what's safe to
  // remove (built-ins are immutable).
  userAdded?: boolean;
  // Display name shown in the UI. For built-ins we just use the id;
  // user-added MCPs can override this from the probe's server name.
  displayName?: string;
  // ISO timestamp when this MCP was added (user-added entries only).
  addedAt?: string;
}

// ─── static (built-in) registry ───────────────────────────────────────────
// Public engine ships an EMPTY built-in registry. All connectors come from
// the per-user BYO path (listUserMcps).
export const CONNECTORS: Record<string, Connector> = {};

/** Optional deploy-owned built-in connector registry. The public repo contains
 * zero private connector names; an operator may inject a JSON object through
 * BUILTIN_CONNECTORS_JSON at deploy time (a private deployment wrapper can do
 * this for its MCP portal). Per-user MCPs still merge on top through Settings.
 */
export function getBuiltinConnectors(env: Env): Record<string, Connector> {
  const raw = (env as unknown as { BUILTIN_CONNECTORS_JSON?: string }).BUILTIN_CONNECTORS_JSON?.trim();
  if (!raw) return CONNECTORS;
  try {
    const parsed = JSON.parse(raw) as Record<string, Connector>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : CONNECTORS;
  } catch (error) {
    console.error("builtin_connectors_config_invalid", { error: error instanceof Error ? error.message : String(error) });
    return CONNECTORS;
  }
}

/** Connectors exposed to the model and active product UI. */
export function callableConnectors(env: Env): Record<string, Connector> {
  return getBuiltinConnectors(env);
}

// Discovery: which connectors auto-DCR on first /authorize call.
// For user-added MCPs, look at the Connector itself — `registrationEndpoint`
// is stored on the Connector when probe.ts discovered one via OAuth 2.0
// Authorization Server Metadata.
export function shouldAutoDcr(connector: Connector): boolean {
  return !!connector.auth.registrationEndpoint && !connector.auth.clientId;
}

// The DCR endpoint for connectors where the Worker auto-registers its own
// client. Returns null for connectors that don't support deployed-Worker DCR.
export function dcrRegistrationEndpoint(connector: Connector): string | null {
  return connector.auth.registrationEndpoint ?? null;
}

/** Merge the built-in registry with a user's BYO MCPs. Caller fetches the
 *  user MCPs from OAuthClientDO.listUserMcps(email) and passes them in.
 *  User-added entries cannot shadow built-ins (same-key collisions resolve
 *  to the static entry). */
export function getMergedRegistry(
  env: Env,
  userMcps: Connector[] = [],
): Record<string, Connector> {
  const out: Record<string, Connector> = { ...getBuiltinConnectors(env) };
  for (const c of userMcps) {
    if (out[c.id]) continue; // refuse to shadow a built-in
    out[c.id] = c;
  }
  return out;
}

/** Look up a connector by id. If userMcps is provided, the search
 *  includes user-added MCPs; otherwise only built-ins. */
export function getConnector(
  env: Env,
  id: string,
  userMcps: Connector[] = [],
): Connector {
  const registry = getMergedRegistry(env, userMcps);
  if (!(id in registry)) {
    throw new ConnectorError(
      "UnknownConnector",
      `Unknown connector "${id}". Available: ${Object.keys(registry).join(", ")}.`,
    );
  }
  return registry[id];
}

// ─── auth resolution ──────────────────────────────────────────────────────
// Per-request: given a connector + the authenticated user, return the headers
// to attach to the upstream fetch.
export async function resolveUpstreamAuth(
  connector: Connector,
  identity: AccessIdentity,
  oauthStore: OAuthClientStore,
): Promise<Headers> {
  const h = new Headers();
  const token = await oauthStore.getValidAccessToken(identity.email, connector.id);
  if (!token) {
    throw new ConnectorError(
      "OAuthNotConsented",
      `User has not authorized "${connector.id}" yet. Direct them to /api/connectors/${connector.id}/authorize to start the OAuth flow.`,
    );
  }
  h.set("Authorization", `Bearer ${token}`);
  return h;
}

// ─── OAuth client store interface (implemented in oauth-store.ts) ─────────
export interface OAuthClientStore {
  // Returns a usable access_token for (user, connector), refreshing if
  // expired. Returns null if user has never authorized this connector.
  getValidAccessToken(
    userEmail: string,
    connectorId: ConnectorId,
    // Optional userMcps so the resolver can find the connector record
    // for user-added MCPs (built-ins are looked up via CONNECTORS).
    userMcps?: Connector[],
  ): Promise<string | null>;

  // Build the authorization URL for the user to complete OAuth.
  // The state param is opaque + tied to the user; the callback verifies it.
  startAuthorization(
    userEmail: string,
    connectorId: ConnectorId,
    redirectBackTo: string,
    userMcps?: Connector[],
  ): Promise<{ authorizationUrl: string; state: string }>;

  // Exchange code for tokens (called by /api/connectors/:id/callback).
  completeAuthorization(
    userEmail: string,
    connectorId: ConnectorId,
    code: string,
    state: string,
    userMcps?: Connector[],
  ): Promise<{ ok: true } | { ok: false; error: string }>;

  // ─── BYO MCP CRUD ─────────────────────────────────────────────────────
  // User-added MCPs are stored per-user in OAuthClientDO. They share the
  // same token-storage backend as built-ins (so existing OAuth flows work
  // unchanged) but carry an extra Connector record under mcps:<id>.

  /** Return all MCPs this user has added. */
  listUserMcps(userEmail: string): Promise<Connector[]>;

  /** Add a user MCP. Caller (the /api/mcps POST handler) is responsible
   *  for slugging the id from the upstream URL and probing the OAuth
   *  metadata. Returns the persisted record. Rejects if id collides with
   *  a built-in or an existing user MCP. */
  addUserMcp(userEmail: string, connector: Connector): Promise<Connector>;

  /** Remove a user-added MCP. Also clears any tokens the user had for it.
   *  Refuses to remove built-ins. */
  removeUserMcp(userEmail: string, connectorId: string): Promise<{ ok: true }>;
}

// ─── errors ───────────────────────────────────────────────────────────────
export class ConnectorError extends Error {
  constructor(public tag: string, message: string) {
    super(message);
  }
}
