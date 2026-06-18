// bridge.ts — JWT-mint + scoped-ticket + per-connector upstream auth
//
// Per-request flow:
//   1. Caller (the agent loop inside MyAgent) mints a short-lived ticket
//      via mintBridgeTicket — HS256, 5-min TTL, claims bound to
//      {identity, sessionId, connectorId, scope}.
//   2. The bridge endpoint (handleBridgeRequest) verifies the ticket,
//      calls connectors.resolveUpstreamAuth() to get the per-user OAuth
//      bearer from OAuthClientDO, forwards to the upstream.
//   3. Audit receipt to AUDIT_KV with 90d TTL.
//
// Pattern source: cto-agent/apps/seal-container-runtime AGENTS.md.
// All connectors today use oauth-bearer auth (RFC 9728 Managed OAuth).

import { SignJWT, jwtVerify } from "jose";
import type { AccessIdentity } from "./auth";
import type { Env } from "./types";
import {
  getConnector,
  resolveUpstreamAuth,
  ConnectorError,
  type ConnectorId,
  type OAuthClientStore,
} from "./connectors";

// handleBridgeRequest now needs the full Env so it can call
// getConnector(env, …), which env-gates the internal built-in registry
// (legacy ticketed bridge path). mintBridgeTicket still only
// needs BRIDGE_JWT_SECRET.
type BridgeEnv = Env;

export interface BridgeTicketClaims {
  identity: AccessIdentity;
  sessionId: string;
  connectorId: ConnectorId;
  scope: string[];
  iat: number;
  exp: number;
  jti: string;
}

const TICKET_TTL_SECONDS = 5 * 60;
const REQUIRED_SCOPE = "connector-call";

async function getKey(secretB64: string): Promise<Uint8Array> {
  const bin = atob(secretB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function mintBridgeTicket(
  env: { BRIDGE_JWT_SECRET: string },
  args: {
    identity: AccessIdentity;
    sessionId: string;
    connectorId: ConnectorId;
    scope?: string[];
  },
): Promise<string> {
  const key = await getKey(env.BRIDGE_JWT_SECRET);
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    identity: args.identity as unknown as Record<string, unknown>,
    sessionId: args.sessionId,
    connectorId: args.connectorId,
    scope: args.scope ?? [REQUIRED_SCOPE],
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + TICKET_TTL_SECONDS)
    .setJti(crypto.randomUUID())
    .sign(key);
}

async function verifyBridgeTicket(
  env: { BRIDGE_JWT_SECRET: string },
  jwt: string,
  expectedConnectorId: string,
): Promise<BridgeTicketClaims> {
  const key = await getKey(env.BRIDGE_JWT_SECRET);
  const { payload } = await jwtVerify(jwt, key, {});

  const claims = payload as unknown as BridgeTicketClaims;
  if (claims.connectorId !== expectedConnectorId) {
    throw new BridgeError(
      "ConnectorMismatch",
      `Ticket connectorId "${claims.connectorId}" does not match path "${expectedConnectorId}".`,
    );
  }
  if (!Array.isArray(claims.scope) || !claims.scope.includes(REQUIRED_SCOPE)) {
    throw new BridgeError(
      "InsufficientScope",
      `Ticket scope ${JSON.stringify(claims.scope)} does not include "${REQUIRED_SCOPE}". Plain agent session tickets are not accepted.`,
    );
  }
  if (typeof claims.jti !== "string" || !claims.jti) {
    throw new BridgeError("MissingTicketId", "Bridge ticket has no replay-protection identifier.");
  }
  return claims;
}

// ─── audit receipt ────────────────────────────────────────────────────────
export interface AuditReceipt {
  user: string;
  sessionId: string;
  connectorId: string;
  authKind: string;
  method: string;
  status: number;
  durationMs: number;
  timestamp: number;
}

async function writeAuditReceipt(
  env: BridgeEnv,
  r: AuditReceipt,
): Promise<void> {
  if (env.AUDIT_KV) {
    const key = `audit/${r.timestamp}-${r.user}-${r.connectorId}-${crypto.randomUUID()}`;
    await env.AUDIT_KV.put(key, JSON.stringify(r), {
      expirationTtl: 60 * 60 * 24 * 90, // 90 days
    });
  }
  console.log("audit_receipt", JSON.stringify(r));
}

// ─── handler ──────────────────────────────────────────────────────────────
export async function handleBridgeRequest(
  request: Request,
  env: BridgeEnv,
  callerIdentity: AccessIdentity,
  pathConnectorId: string,
  upstreamPath: string,
  oauthStore: OAuthClientStore,
): Promise<Response> {
  const t0 = Date.now();
  let claims: BridgeTicketClaims;
  let connector: ReturnType<typeof getConnector>;

  try {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer "))
      throw new BridgeError("NoBearer", "Missing Bearer token");
    claims = await verifyBridgeTicket(
      env,
      auth.slice("Bearer ".length),
      pathConnectorId,
    );
    if (claims.identity.email.toLowerCase() !== callerIdentity.email.toLowerCase() || claims.identity.sub !== callerIdentity.sub) {
      throw new BridgeError("TicketSubjectMismatch", "Bridge ticket subject does not match the authenticated Access caller");
    }
    // Consume the ticket before resolving credentials or making an upstream
    // request. The primary key makes concurrent replays fail atomically.
    try {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM bridge_ticket_uses WHERE expires_at < ?").bind(Math.floor(Date.now() / 1000)),
        env.DB.prepare("INSERT INTO bridge_ticket_uses(jti, owner_email, expires_at) VALUES (?, ?, ?)")
          .bind(claims.jti, claims.identity.email.toLowerCase(), claims.exp),
      ]);
    } catch {
      throw new BridgeError("TicketReplay", "Bridge ticket has already been used");
    }
    // Resolve from built-ins first; if not found, fall back to the user's
    // BYO MCPs. listUserMcps requires the verified identity from the
    // ticket — anyone forging a request without a valid ticket fails at
    // verifyBridgeTicket above.
    const userMcps = await oauthStore.listUserMcps(claims.identity.email);
    connector = getConnector(env, pathConnectorId, userMcps);
  } catch (err) {
    const e =
      err instanceof BridgeError
        ? err
        : new BridgeError("BridgeAuth", (err as Error).message);
    return Response.json(
      { ok: false, error: { tag: e.tag, message: e.message } },
      { status: e.tag === "TicketSubjectMismatch" ? 403 : 401 },
    );
  }

  // Dispatch on auth. resolveUpstreamAuth throws OAuthNotConsented if the
  // user hasn't completed the OAuth dance yet — we surface 412 with the
  // authorize URL so the client (chat banner, Settings drawer Connectors
  // row, or agent prompt) can direct the user there.
  let upstreamHeaders: Headers;
  const usedAuthKind: string = connector.auth.kind;
  try {
    upstreamHeaders = await resolveUpstreamAuth(
      connector,
      claims.identity,
      oauthStore,
    );
  } catch (err) {
    if (err instanceof ConnectorError && err.tag === "OAuthNotConsented") {
      return Response.json(
        {
          ok: false,
          error: {
            tag: err.tag,
            message: err.message,
            authorize_url: `/api/connectors/${connector.id}/authorize`,
          },
        },
        { status: 412 }, // Precondition Failed: needs consent
      );
    }
    throw err;
  }

  // Forward content-type and body, strip auth headers from inbound.
  for (const [k, v] of request.headers) {
    const lk = k.toLowerCase();
    if (lk === "authorization") continue;
    if (lk.startsWith("cf-access-")) continue;
    if (!upstreamHeaders.has(k)) upstreamHeaders.set(k, v);
  }

  // Build upstream URL. If the caller passed only "/" (e.g. POST /bridge/<connector>/),
  // many MCP servers reject "/mcp/" so we strip the bare trailing slash and call /mcp directly.
  // For non-root paths, preserve them: "/v1/chat/completions" → "<upstream>/v1/chat/completions".
  let upstreamUrl: string;
  if (upstreamPath === "/" || upstreamPath === "") {
    upstreamUrl = connector.upstream;
  } else {
    upstreamUrl = `${connector.upstream}${upstreamPath.startsWith("/") ? "" : "/"}${upstreamPath}`;
  }
  const upstreamRes = await fetch(upstreamUrl, {
    method: request.method,
    headers: upstreamHeaders,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
  });

  await writeAuditReceipt(env, {
    user: claims.identity.email,
    sessionId: claims.sessionId,
    connectorId: claims.connectorId,
    authKind: usedAuthKind,
    method: `${request.method} ${upstreamPath}`,
    status: upstreamRes.status,
    durationMs: Date.now() - t0,
    timestamp: Date.now(),
  });

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: upstreamRes.headers,
  });
}

export class BridgeError extends Error {
  constructor(public tag: string, message: string) {
    super(message);
  }
}
