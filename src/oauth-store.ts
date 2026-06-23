// oauth-store.ts — per-user OAuth token storage + refresh.
//
// One DO instance per user (idFromName(userEmail)). Stores access+refresh
// tokens for each connector the user has authorized. Refreshes proactively
// before expiry. PKCE state lives here briefly during the auth dance.
//
// Pattern source: apps/oauth-proxy/src in cto-agent monorepo (lifted shape,
// not code — that lives in @cloudflare/oauth-proxy and isn't published yet).
// Differences from oauth-proxy:
//   - Per-user records keyed by verified Access identity.
//   - Includes RFC 8707 resource indicator on every authz + token call
//   - No KV cache layer; DO storage is sufficient at this volume.
//   - Audit receipts written to AUDIT_KV alongside bridge.ts receipts
//
// SECURITY NOTES:
//   - Tokens are encrypted at rest with AES-GCM-256 using per-user keys
//     derived from MASTER_KEY via HKDF. Legacy plaintext records are retained
//     only for migration and are re-encrypted on their next write.
//   - PKCE state is bound to the user and connector and expires after 5 minutes
//     in DO storage.
//   - Pre-registered connectors may share a configured clientId across users;
//     connectors advertising Dynamic Client Registration receive per-flow IDs.

import { DurableObject } from "cloudflare:workers";
import {
  getBuiltinConnectors,
  type ConnectorId,
  type Connector,
  type OAuthClientStore,
  shouldAutoDcr,
  dcrRegistrationEndpoint,
} from "./connectors";
import { Effect, Schedule, Duration } from "effect";
import type { Env } from "./types";
import { encryptToken, decryptToken, looksEncrypted } from "./grant-crypto";
import { requirePublicHttpsUrl } from "./public-url";

// Token-endpoint calls can hit transient network blips; without a retry, a
// single blip forces an unnecessary full re-authorization. Retry only on a
// thrown network error (an HTTP response is a real answer), and bound it with
// a timeout. No token/crypto logic runs here — this is purely the transport.
function resilientTokenFetch(input: string, init: RequestInit): Promise<Response | null> {
  return Effect.runPromise(
    Effect.tryPromise({ try: () => fetch(input, init), catch: (cause) => cause })
      .pipe(
        Effect.timeout(Duration.seconds(10)),
        Effect.retry(Schedule.intersect(Schedule.exponential(Duration.millis(200), 2).pipe(Schedule.jittered), Schedule.recurs(2))),
        Effect.orElseSucceed(() => null),
      ),
  );
}

interface StoredTokenSet {
  // ENCRYPTED: see grant-crypto.ts. Values are v1.<salt>.<iv>.<ciphertext>
  // strings. On legacy DOs that pre-date encryption, plain strings here are
  // re-encrypted on first read.
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
  token_type: string;
  resource?: string;
  // When the OAuth dance used Dynamic Client Registration (RFC 7591), the
  // refresh_token is bound to the DCR client_id (NOT the hardcoded one in
  // connectors.ts). Store it so refresh uses the right client_id. Otherwise
  // cf-mcp rejects the refresh as "client_id mismatch" and the token is
  // dead at first refresh — proven 2026-05-10 when service-token kept
  // taking over after the dance "succeeded".
  dynamic_client_id?: string;
  // Bookkeeping
  obtained_at: number;
  last_refreshed_at?: number;
}

interface DecryptedTokenSet extends Omit<StoredTokenSet, "access_token" | "refresh_token"> {
  access_token: string;       // plaintext after decrypt
  refresh_token?: string;     // plaintext after decrypt
}

interface PendingAuthorization {
  user: string;
  connectorId: ConnectorId;
  codeVerifier: string;
  redirectBackTo: string;
  expiresAt: number;
  // For connectors that auto-DCR on first authorize, the
  // freshly minted client_id is stashed here so completeAuthorization can
  // both POST to /token with it and persist it as dynamic_client_id in
  // the user's tokens record.
  dynamicClientId?: string;
}

const STATE_TTL_SECONDS = 5 * 60;
const REFRESH_LEEWAY_SECONDS = 60; // refresh tokens 60s before expiry

// One DO per user. Storage layout:
//   tokens:<connectorId>            → StoredTokenSet (encrypted at rest)
//   pending:<state>                 → PendingAuthorization
//   mcps:<connectorId>              → Connector (user-added MCPs, BYO)
//
// The connector record for user-added MCPs is stored UNENCRYPTED — it
// contains only public OAuth metadata (authorization/token endpoints,
// resource URI, optional discovered registration endpoint, plus the
// upstream URL the user pasted). Tokens for those MCPs go under
// tokens:<id> just like built-ins, and ARE encrypted.
// Widened from { MASTER_KEY: string } to the full Env so the DO can read
// deploy-provided configuration via getBuiltinConnectors(env). DOs always receive the parent
// Worker's full env binding — the original narrow type was just type discipline,
// not a runtime constraint.
export class OAuthClientDO extends DurableObject<Env> {
  // Per-user scope for crypto. Uses the DO instance name (set as
  // `user:<email>` by makeOAuthClientStore.stubFor) — so the user portion of
  // the key derivation is bound to the DO ID itself, which the worker code
  // can't lie about.
  private get userScope(): string {
    // ctx.id.name is the human-readable id we passed to idFromName().
    // For user DOs that's "user:<email-lowercase>".
    // Fallback to id string if name is unavailable.
    return this.ctx.id.name ?? this.ctx.id.toString();
  }

  private get masterKey(): string {
    const k = this.env.MASTER_KEY;
    if (!k) throw new Error("MASTER_KEY env var not set; cannot encrypt/decrypt OAuth tokens");
    return k;
  }

  private async encrypt(plaintext: string): Promise<string> {
    return encryptToken(this.masterKey, this.userScope, plaintext);
  }

  private async decryptOrPassthrough(value: string): Promise<string> {
    // Legacy plaintext tokens (pre-encryption rollout) just return as-is and
    // get re-encrypted on next write.
    if (!looksEncrypted(value)) return value;
    return decryptToken(this.masterKey, this.userScope, value);
  }

  private async encryptStoredSet(plain: DecryptedTokenSet): Promise<StoredTokenSet> {
    return {
      ...plain,
      access_token: await this.encrypt(plain.access_token),
      refresh_token: plain.refresh_token ? await this.encrypt(plain.refresh_token) : undefined,
    };
  }

  private async decryptStoredSet(stored: StoredTokenSet): Promise<DecryptedTokenSet> {
    return {
      ...stored,
      access_token: await this.decryptOrPassthrough(stored.access_token),
      refresh_token: stored.refresh_token ? await this.decryptOrPassthrough(stored.refresh_token) : undefined,
    };
  }

  /** Resolve a connector id to its Connector record. Checks the env-gated
   *  built-in registry first (empty on public OSS, internal-overlay on
   *  BUILTIN_CONNECTORS_JSON), then this user's BYO MCPs (mcps:<id> in DO
   *  storage). Returns null if neither has it. */
  private async resolveConnector(id: string): Promise<Connector | null> {
    const builtins = getBuiltinConnectors(this.env);
    if (id in builtins) return builtins[id];
    const stored = await this.ctx.storage.get<Connector>(`mcps:${id}`);
    return stored ?? null;
  }

  // ─── HTTP API (called from index.ts routes) ──────────────────────────
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/start" && req.method === "POST") {
      const { userEmail, connectorId, redirectBackTo, workerOrigin } =
        await req.json<{
          userEmail: string;
          connectorId: ConnectorId;
          redirectBackTo: string;
          workerOrigin: string;
        }>();
      const result = await this.startAuthorizationInternal(
        userEmail,
        connectorId,
        redirectBackTo,
        workerOrigin,
      );
      return Response.json(result);
    }

    if (path === "/complete" && req.method === "POST") {
      const { userEmail, connectorId, code, state, workerOrigin } =
        await req.json<{
          userEmail: string;
          connectorId: ConnectorId;
          code: string;
          state: string;
          workerOrigin: string;
        }>();
      const result = await this.completeAuthorizationInternal(
        userEmail,
        connectorId,
        code,
        state,
        workerOrigin,
      );
      return Response.json(result);
    }

    if (path === "/token" && req.method === "POST") {
      const { connectorId } = await req.json<{ connectorId: ConnectorId }>();
      const token = await this.getValidAccessTokenInternal(connectorId);
      return Response.json({ token });
    }

    if (path === "/status" && req.method === "GET") {
      const status = await this.statusInternal();
      return Response.json(status);
    }

    if (path === "/import" && req.method === "POST") {
      const { connectorId, accessToken, refreshToken, expiresIn, scope, tokenType, resource, dynamicClientId } =
        await req.json<{
          connectorId: ConnectorId;
          accessToken: string;
          refreshToken?: string;
          expiresIn: number;
          scope?: string;
          tokenType: string;
          resource?: string;
          dynamicClientId?: string;
        }>();
      const result = await this.importTokenInternal(connectorId, {
        accessToken,
        refreshToken,
        expiresIn,
        scope,
        tokenType,
        resource,
        dynamicClientId,
      });
      return Response.json(result);
    }

    if (path === "/disconnect" && req.method === "POST") {
      const { connectorId } = await req.json<{ connectorId: ConnectorId }>();
      const result = await this.disconnectInternal(connectorId);
      return Response.json(result);
    }

    // ── BYO MCP routes ─────────────────────────────────────────────────
    if (path === "/mcps/list" && req.method === "GET") {
      const mcps = await this.listUserMcpsInternal();
      return Response.json({ mcps });
    }
    if (path === "/mcps/add" && req.method === "POST") {
      const { connector } = await req.json<{ connector: Connector }>();
      const result = await this.addUserMcpInternal(connector);
      return Response.json(result);
    }
    if (path === "/mcps/remove" && req.method === "POST") {
      const { connectorId } = await req.json<{ connectorId: string }>();
      const result = await this.removeUserMcpInternal(connectorId);
      return Response.json(result);
    }

    return new Response("not found", { status: 404 });
  }

  // ─── core operations ─────────────────────────────────────────────────
  private async startAuthorizationInternal(
    user: string,
    connectorId: ConnectorId,
    redirectBackTo: string,
    workerOrigin: string,
  ): Promise<{
    authorizationUrl: string;
    state: string;
  }> {
    const connector = await this.resolveConnector(connectorId);
    if (!connector) {
      throw new Error(`Unknown connector "${connectorId}" — not in built-ins or this user's BYO MCPs`);
    }
    if (connector.auth.kind !== "oauth-bearer") {
      throw new Error(`Connector ${connectorId} is not oauth-bearer`);
    }
    const auth = connector.auth;

    // PKCE: 43-char verifier, S256 challenge
    const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
    const codeVerifier = base64UrlEncode(verifierBytes).slice(0, 43);
    const challengeBytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(codeVerifier),
    );
    const codeChallenge = base64UrlEncode(new Uint8Array(challengeBytes));

    const stateBytes = crypto.getRandomValues(new Uint8Array(16));
    const state = base64UrlEncode(stateBytes);

    const callbackUrl = `${workerOrigin}/api/connectors/${connectorId}/callback`;

    // For user-added MCPs whose /.well-known doc advertised a
    // registration_endpoint, mint a fresh client_id here via DCR. The
    // upstream auth server allows DCR by definition.
    let clientId = auth.clientId;
    let dynamicClientId: string | undefined;
    if (shouldAutoDcr(connector)) {
      const regEndpoint = dcrRegistrationEndpoint(connector);
      if (!regEndpoint) {
        throw new Error(`shouldAutoDcr returned true but dcrRegistrationEndpoint is null for ${connectorId}`);
      }
      const dcrUrl = requirePublicHttpsUrl(regEndpoint);
      const dcrResp = await fetch(dcrUrl, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: `my-ax-${user}-${Date.now()}`,
          redirect_uris: [callbackUrl],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      });
      if (!dcrResp.ok) {
        throw new Error(
          `DCR failed for ${connectorId}: HTTP ${dcrResp.status} ${(await dcrResp.text()).slice(0, 400)}`,
        );
      }
      const dcrData = (await dcrResp.json()) as { client_id: string };
      clientId = dcrData.client_id;
      dynamicClientId = dcrData.client_id;
    }

    const pending: PendingAuthorization = {
      user,
      connectorId,
      codeVerifier,
      redirectBackTo,
      expiresAt: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
      dynamicClientId,
    };
    await this.ctx.storage.put(`pending:${state}`, pending);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      redirect_uri: callbackUrl,
      resource: auth.resource, // RFC 8707 — REQUIRED by some MCP auth servers
    });
    const authorizationUrl = `${auth.authorizationEndpoint}?${params.toString()}`;

    return { authorizationUrl, state };
  }

  private async completeAuthorizationInternal(
    user: string,
    connectorId: ConnectorId,
    code: string,
    state: string,
    workerOrigin: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const pending = await this.ctx.storage.get<PendingAuthorization>(
      `pending:${state}`,
    );
    if (!pending) {
      return { ok: false, error: "Unknown or expired state parameter" };
    }
    if (pending.user !== user || pending.connectorId !== connectorId) {
      return { ok: false, error: "State binding mismatch" };
    }
    if (Math.floor(Date.now() / 1000) > pending.expiresAt) {
      await this.ctx.storage.delete(`pending:${state}`);
      return { ok: false, error: "State expired" };
    }

    const connector = await this.resolveConnector(connectorId);
    if (!connector) {
      return { ok: false, error: `Unknown connector "${connectorId}"` };
    }
    if (connector.auth.kind !== "oauth-bearer") {
      return { ok: false, error: "Connector not oauth-bearer" };
    }
    const auth = connector.auth;

    const callbackUrl = `${workerOrigin}/api/connectors/${connectorId}/callback`;
    // For DCR'd flows, the client_id used at /token MUST match the one
    // used at /authorize. We stashed it on pending; fall back to the
    // static auth.clientId for pre-registered flows.
    const tokenClientId = pending.dynamicClientId ?? auth.clientId;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: tokenClientId,
      code_verifier: pending.codeVerifier,
      redirect_uri: callbackUrl,
      resource: auth.resource,
    });

    const tokenUrl = requirePublicHttpsUrl(auth.tokenEndpoint);
    const tokenResp = await fetch(tokenUrl, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!tokenResp.ok) {
      const errBody = await tokenResp.text();
      return {
        ok: false,
        error: `Token exchange failed: HTTP ${tokenResp.status} ${errBody.slice(0, 400)}`,
      };
    }

    const tokenData = (await tokenResp.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
      token_type: string;
      resource?: string;
    };

    const plainSet: DecryptedTokenSet = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (tokenData.expires_in ?? 900),
      scope: tokenData.scope,
      token_type: tokenData.token_type,
      resource: tokenData.resource,
      // Persist the DCR client_id so refresh uses the same one. Without
      // this, the next refresh hits auth.clientId (the static seed) which
      // cf-mcp rejects — silent fallback to service-token, banner reappears.
      dynamic_client_id: pending.dynamicClientId,
      obtained_at: Math.floor(Date.now() / 1000),
    };

    await this.ctx.storage.put(`tokens:${connectorId}`, await this.encryptStoredSet(plainSet));
    await this.ctx.storage.delete(`pending:${state}`);
    return { ok: true };
  }

  private async getValidAccessTokenInternal(
    connectorId: ConnectorId,
  ): Promise<string | null> {
    const stored = await this.ctx.storage.get<StoredTokenSet>(
      `tokens:${connectorId}`,
    );
    if (!stored) return null;

    const decrypted = await this.decryptStoredSet(stored);

    const now = Math.floor(Date.now() / 1000);
    const expiringSoon = decrypted.expires_at - now < REFRESH_LEEWAY_SECONDS;

    if (!expiringSoon) {
      return decrypted.access_token;
    }

    // Try refresh
    if (!decrypted.refresh_token) {
      // Token expired and no refresh — user must re-authorize
      return null;
    }

    const connector = await this.resolveConnector(connectorId);
    if (!connector || connector.auth.kind !== "oauth-bearer") return null;
    const auth = connector.auth;

    // If the dance used DCR (Dynamic Client Registration), the refresh_token
    // is bound to that DCR client_id. Use the stored one when present;
    // fall back to the static one in connectors.ts (legacy path / shared
    // client setups).
    const refreshClientId = decrypted.dynamic_client_id ?? auth.clientId;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: decrypted.refresh_token,
      client_id: refreshClientId,
      resource: auth.resource,
    });
    let refreshUrl: URL;
    try {
      refreshUrl = requirePublicHttpsUrl(auth.tokenEndpoint);
    } catch {
      return null;
    }
    const refreshResp = await resilientTokenFetch(refreshUrl.toString(), {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!refreshResp || !refreshResp.ok) {
      // Refresh failed (network exhausted or provider rejection) — return null
      // and let the caller surface OAuthNotConsented to trigger re-auth.
      return null;
    }
    const refreshed = (await refreshResp.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
      token_type: string;
    };
    const updatedPlain: DecryptedTokenSet = {
      ...decrypted,
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? decrypted.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + (refreshed.expires_in ?? 900),
      last_refreshed_at: Math.floor(Date.now() / 1000),
    };
    await this.ctx.storage.put(`tokens:${connectorId}`, await this.encryptStoredSet(updatedPlain));
    return updatedPlain.access_token;
  }

  // ─── import: side-channel OAuth token ingestion ──────────────────────
  // Used by /api/connectors/:id/import-token. The user (or local CLI)
  // completed the OAuth dance against a localhost redirect_uri (cf-mcp's
  // DCR limitation), and POSTs the bearer + refresh_token here. We store
  // identically to a normal completeAuth() outcome.
  private async importTokenInternal(
    connectorId: ConnectorId,
    args: {
      accessToken: string;
      refreshToken?: string;
      expiresIn: number;
      scope?: string;
      tokenType: string;
      resource?: string;
      dynamicClientId?: string;
    },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!args.accessToken || typeof args.accessToken !== "string") {
      return { ok: false, error: "access_token required" };
    }
    if (args.accessToken.length > 4096) {
      return { ok: false, error: "access_token too long" };
    }
    if (args.refreshToken && args.refreshToken.length > 4096) {
      return { ok: false, error: "refresh_token too long" };
    }
    if (args.dynamicClientId && args.dynamicClientId.length > 256) {
      return { ok: false, error: "dynamic_client_id too long" };
    }
    if (typeof args.expiresIn !== "number" || args.expiresIn < 1 || args.expiresIn > 60 * 60 * 24 * 90) {
      return { ok: false, error: "expires_in out of bounds (1s..90d)" };
    }

    const plainSet: DecryptedTokenSet = {
      access_token: args.accessToken,
      refresh_token: args.refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + args.expiresIn,
      scope: args.scope,
      token_type: args.tokenType,
      resource: args.resource,
      dynamic_client_id: args.dynamicClientId,
      obtained_at: Math.floor(Date.now() / 1000),
    };
    await this.ctx.storage.put(`tokens:${connectorId}`, await this.encryptStoredSet(plainSet));
    return { ok: true };
  }

  private async disconnectInternal(
    connectorId: ConnectorId,
  ): Promise<{ ok: true }> {
    await this.ctx.storage.delete(`tokens:${connectorId}`);
    // Also clear any pending authorizations for this connector
    const list = await this.ctx.storage.list({ prefix: "pending:" });
    for (const [key, value] of list) {
      const pending = value as PendingAuthorization;
      if (pending.connectorId === connectorId) {
        await this.ctx.storage.delete(key);
      }
    }
    return { ok: true };
  }

  private async statusInternal(): Promise<{
    connectors: Array<{
      id: ConnectorId;
      authorized: boolean;
      expiresInSeconds?: number;
    }>;
  }> {
    // Built-ins (env-gated) + this user's BYO MCPs.
    const userMcpIds = await this.listUserMcpIdsInternal();
    const allIds = [...new Set([...Object.keys(getBuiltinConnectors(this.env)), ...userMcpIds])];
    const connectors = await Promise.all(
      allIds.map(async (id) => {
        const connector = await this.resolveConnector(id);
        if (!connector || connector.auth.kind !== "oauth-bearer") {
          return { id, authorized: false };
        }
        const stored = await this.ctx.storage.get<StoredTokenSet>(
          `tokens:${id}`,
        );
        if (!stored) return { id, authorized: false };
        const now = Math.floor(Date.now() / 1000);
        return {
          id,
          authorized: true,
          expiresInSeconds: stored.expires_at - now,
        };
      }),
    );
    return { connectors };
  }

  // ─── BYO MCP CRUD (internal) ─────────────────────────────────────────
  private async listUserMcpsInternal(): Promise<Connector[]> {
    const list = await this.ctx.storage.list<Connector>({ prefix: "mcps:" });
    const out: Connector[] = [];
    for (const [, c] of list) out.push(c);
    // Stable order: oldest-added first (addedAt ascending). UI can re-sort.
    out.sort((a, b) => (a.addedAt ?? "").localeCompare(b.addedAt ?? ""));
    return out;
  }

  private async listUserMcpIdsInternal(): Promise<string[]> {
    const list = await this.ctx.storage.list({ prefix: "mcps:" });
    const out: string[] = [];
    for (const [k] of list) out.push(k.slice("mcps:".length));
    return out;
  }

  private async addUserMcpInternal(
    connector: Connector,
  ): Promise<{ ok: true; connector: Connector } | { ok: false; error: string }> {
    // Refuse to shadow a built-in (the public engine ships an empty
    // built-in registry, so this is mainly a guard for future overlays).
    if (connector.id in getBuiltinConnectors(this.env)) {
      return {
        ok: false,
        error: `"${connector.id}" is a reserved built-in id; pick a different slug`,
      };
    }
    // Refuse to overwrite an existing user MCP (caller should DELETE first).
    const existing = await this.ctx.storage.get<Connector>(`mcps:${connector.id}`);
    if (existing) {
      return {
        ok: false,
        error: `MCP "${connector.id}" already exists; remove it first if you want to replace`,
      };
    }
    // Force the userAdded flag; never trust the wire payload to set it.
    const persisted: Connector = {
      ...connector,
      userAdded: true,
      addedAt: connector.addedAt ?? new Date().toISOString(),
    };
    await this.ctx.storage.put(`mcps:${connector.id}`, persisted);
    return { ok: true, connector: persisted };
  }

  private async removeUserMcpInternal(
    connectorId: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (connectorId in getBuiltinConnectors(this.env)) {
      return { ok: false, error: `"${connectorId}" is a built-in; cannot remove` };
    }
    const existing = await this.ctx.storage.get<Connector>(`mcps:${connectorId}`);
    if (!existing) {
      return { ok: false, error: `MCP "${connectorId}" not found` };
    }
    // Drop the record + any tokens we minted for it. Pending authorizations
    // for the same id (rare race) get cleared via the same loop as
    // disconnectInternal.
    await this.ctx.storage.delete(`mcps:${connectorId}`);
    await this.ctx.storage.delete(`tokens:${connectorId}`);
    const pendings = await this.ctx.storage.list({ prefix: "pending:" });
    for (const [key, value] of pendings) {
      const pending = value as PendingAuthorization;
      if (pending.connectorId === connectorId) {
        await this.ctx.storage.delete(key);
      }
    }
    return { ok: true };
  }
}

export interface OAuthClientStoreExt extends OAuthClientStore {
  importToken(
    userEmail: string,
    connectorId: ConnectorId,
    args: {
      accessToken: string;
      refreshToken?: string;
      expiresIn: number;
      scope?: string;
      tokenType?: string;
      resource?: string;
      // Pass when the OAuth dance used DCR (Dynamic Client Registration);
      // the refresh path will use this client_id instead of the static one
      // in connectors.ts.
      dynamicClientId?: string;
    },
  ): Promise<{ ok: true } | { ok: false; error: string }>;

  disconnect(userEmail: string, connectorId: ConnectorId): Promise<{ ok: true }>;
}

// ─── facade implementing the OAuthClientStore interface for the rest of
//     the app. Routes lookups to the per-user DO.
export function makeOAuthClientStore(
  binding: DurableObjectNamespace<OAuthClientDO>,
  workerOrigin: string,
): OAuthClientStoreExt {
  function stubFor(userEmail: string) {
    return binding.get(binding.idFromName(`user:${userEmail.toLowerCase()}`));
  }

  return {
    async getValidAccessToken(userEmail, connectorId) {
      const stub = stubFor(userEmail);
      const res = await stub.fetch("http://internal/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId }),
      });
      const data = (await res.json()) as { token: string | null };
      return data.token;
    },
    async startAuthorization(userEmail, connectorId, redirectBackTo) {
      const stub = stubFor(userEmail);
      const res = await stub.fetch("http://internal/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail,
          connectorId,
          redirectBackTo,
          workerOrigin,
        }),
      });
      return (await res.json()) as {
        authorizationUrl: string;
        state: string;
      };
    },
    async completeAuthorization(userEmail, connectorId, code, state) {
      const stub = stubFor(userEmail);
      const res = await stub.fetch("http://internal/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail,
          connectorId,
          code,
          state,
          workerOrigin,
        }),
      });
      return (await res.json()) as
        | { ok: true }
        | { ok: false; error: string };
    },
    async importToken(userEmail, connectorId, args) {
      const stub = stubFor(userEmail);
      const res = await stub.fetch("http://internal/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectorId,
          accessToken: args.accessToken,
          refreshToken: args.refreshToken,
          expiresIn: args.expiresIn,
          scope: args.scope,
          tokenType: args.tokenType ?? "bearer",
          resource: args.resource,
          dynamicClientId: args.dynamicClientId,
        }),
      });
      return (await res.json()) as
        | { ok: true }
        | { ok: false; error: string };
    },
    async disconnect(userEmail, connectorId) {
      const stub = stubFor(userEmail);
      const res = await stub.fetch("http://internal/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId }),
      });
      return (await res.json()) as { ok: true };
    },
    async listUserMcps(userEmail) {
      const stub = stubFor(userEmail);
      const res = await stub.fetch("http://internal/mcps/list", { method: "GET" });
      const data = (await res.json()) as { mcps: Connector[] };
      return data.mcps ?? [];
    },
    async addUserMcp(userEmail, connector) {
      const stub = stubFor(userEmail);
      const res = await stub.fetch("http://internal/mcps/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connector }),
      });
      const data = (await res.json()) as
        | { ok: true; connector: Connector }
        | { ok: false; error: string };
      if (!data.ok) throw new Error(data.error);
      return data.connector;
    },
    async removeUserMcp(userEmail, connectorId) {
      const stub = stubFor(userEmail);
      const res = await stub.fetch("http://internal/mcps/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId }),
      });
      const data = (await res.json()) as
        | { ok: true }
        | { ok: false; error: string };
      if (!data.ok) throw new Error(data.error);
      return { ok: true };
    },
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────
function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Build the request-scoped OAuth store used by HTTP routes. */
export function oauthStoreFor(c: { req: { url: string }; env: Env }) {
  return makeOAuthClientStore(c.env.OAUTH_CLIENT!, new URL(c.req.url).origin);
}
