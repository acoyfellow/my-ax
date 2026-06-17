// mcp-probe.ts — discover OAuth + MCP metadata from a URL the user pasted.
//
// The goal: user pastes "https://mcp.linear.app" (or similar), and we
// figure out everything we need to register it as a BYO connector:
//
//   1. Slug an id from the host ("mcp.linear.app" → "linear").
//   2. Hit /.well-known/oauth-authorization-server and extract:
//       - authorization_endpoint
//       - token_endpoint
//       - registration_endpoint (if DCR is supported)
//   3. Optionally: hit /.well-known/openid-configuration as a fallback if
//      the OAuth metadata doc isn't there.
//   4. Optionally: do an unauthenticated JSON-RPC `initialize` to confirm
//      the URL really speaks MCP and to grab a server name.
//
// Returns a fully-formed Connector record + a "reachable" flag, ready to
// hand to OAuthClientStore.addUserMcp. The caller is the POST /api/mcps
// route handler.
//
// Spec references:
//   - RFC 8414 (OAuth 2.0 Authorization Server Metadata)
//   - RFC 7591 (Dynamic Client Registration)
//   - https://modelcontextprotocol.io/specification — initialize shape
//
// Failure modes we surface (each maps to a non-200 in the POST handler):
//   - "not_https"        : URL isn't HTTPS (refuse — token storage relies on TLS)
//   - "fetch_failed"     : network/DNS/cert error reaching the host
//   - "no_oauth_metadata": neither well-known endpoint returned a usable doc
//   - "not_mcp"          : initialize call didn't return an MCP-shaped response
//   - "invalid_url"      : URL didn't parse
//
// The probe is read-only. It registers no DCR client, mints no tokens,
// and writes nothing to the user's DO. Adding the MCP for real happens
// in a separate POST /api/mcps call once the user accepts the probe
// results.

import { Effect, Schedule, Duration } from "effect";
import type { Connector, ConnectorAuth, ConnectorShape } from "./connectors";
import { safePublicHttpUrl } from "./public-url";

// A user-pasted MCP host is untrusted and may be slow or flaky. Bound every
// probe fetch with a timeout and retry only transient network failures (never
// HTTP responses, which are real answers). SSRF guards live in safeHttpsUrl /
// redirect:"manual" below.
const PROBE_TIMEOUT = Duration.seconds(8);
const probeRetry = Schedule.intersect(
  Schedule.exponential(Duration.millis(200), 2).pipe(Schedule.jittered),
  Schedule.recurs(1),
);
function probeFetch(input: string, init: RequestInit): Promise<Response | null> {
  return Effect.runPromise(
    Effect.tryPromise({ try: () => fetch(input, init), catch: (cause) => cause })
      .pipe(Effect.timeout(PROBE_TIMEOUT), Effect.retry(probeRetry), Effect.orElseSucceed(() => null)),
  );
}

function safeHttpsUrl(raw: string): URL | null {
  return safePublicHttpUrl(raw, { httpsOnly: true });
}

export interface ProbeResult {
  ok: true;
  connector: Connector;
  /** Did the upstream advertise DCR? UI can show "will auto-register" hint. */
  dcrAvailable: boolean;
  /** Did the MCP `initialize` call succeed? UI can show "MCP confirmed".
   *  False ≠ broken — many MCP servers require auth even for initialize. */
  mcpConfirmed: boolean;
  /** If we successfully called initialize, the server's self-reported name. */
  serverName?: string;
}

export interface ProbeError {
  ok: false;
  error:
    | "not_https"
    | "fetch_failed"
    | "no_oauth_metadata"
    | "not_mcp"
    | "invalid_url";
  detail: string;
}

/** Slug an upstream URL into a stable connector id. Picks the most
 *  identifying piece of the hostname:
 *    https://mcp.linear.app      → "linear"
 *    https://api.notion.com/mcp  → "notion"
 *    https://example.com         → "example"
 *    https://foo.bar.baz.io      → "bar"
 *
 *  The rule: take the second-to-last label (the registrable name in
 *  ~99% of cases). If the host has only one or two labels total ("foo",
 *  "foo.com"), use the first label as-is. Strip subdomain prefixes that
 *  we know to be uninformative ("mcp", "api", "www").
 *
 *  The id is intended to be human-typeable + stable across re-adds. We
 *  don't fight users who paste the same URL twice with a different
 *  protocol or trailing slash. */
export function slugIdFromUrl(rawUrl: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return "mcp"; // caller should reject before getting here
  }
  const host = u.hostname.toLowerCase();
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 1) return parts[0] || "mcp";
  // Two-label hosts ("linear.app") → take the first label.
  if (parts.length === 2) return parts[0];
  // Three+ labels: pick the second-to-last (registrable name).
  return parts[parts.length - 2];
}

/** Attempt to fetch the OAuth 2.0 Authorization Server Metadata doc.
 *  RFC 8414 specifies /.well-known/oauth-authorization-server. We also
 *  try the OIDC well-known path as a fallback because many MCP servers
 *  reuse an OIDC IdP. */
async function fetchOAuthMetadata(
  origin: string,
): Promise<Record<string, unknown> | null> {
  const candidates = [
    `${origin}/.well-known/oauth-authorization-server`,
    `${origin}/.well-known/openid-configuration`,
  ];
  for (const url of candidates) {
    try {
      // Metadata redirects are rejected. Following them would let a public
      // hostname launder a server-side request to a private destination.
      const r = await probeFetch(url, { headers: { Accept: "application/json" }, redirect: "manual" });
      if (!r || !r.ok) continue;
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("json")) continue;
      const data = (await r.json()) as Record<string, unknown>;
      // Sanity: must have at least authorization_endpoint + token_endpoint.
      if (
        typeof data.authorization_endpoint === "string" &&
        typeof data.token_endpoint === "string"
      ) {
        return data;
      }
    } catch {
      // ignore; try next candidate
    }
  }
  return null;
}

/** Best-effort MCP initialize call. Some MCP servers refuse unauth'd
 *  initialize entirely (returns 401/403); that's not an error from the
 *  probe's perspective — we just can't confirm MCP shape. Returns the
 *  server name on success, null on any failure. */
async function tryInitialize(upstream: string): Promise<string | null> {
  try {
    const r = await probeFetch(upstream, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "my-ax-probe", version: "0.1.0" },
        },
      }),
    });
    if (!r || !r.ok) return null;
    const text = await r.text();
    // Response might be SSE-framed (text/event-stream) — strip "data: " prefix.
    let body = text.trim();
    if (body.startsWith("event:") || body.includes("\ndata: ")) {
      const dataLines = body
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => l.slice(6));
      body = dataLines.join("");
    }
    const parsed = JSON.parse(body) as {
      result?: { serverInfo?: { name?: string } };
    };
    return parsed.result?.serverInfo?.name ?? null;
  } catch {
    return null;
  }
}

/** Probe an MCP URL. See file-level comment for spec + failure modes. */
export async function probeMcp(rawUrl: string): Promise<ProbeResult | ProbeError> {
  // 1. URL hygiene.
  let upstream: URL;
  try {
    upstream = new URL(rawUrl);
  } catch {
    return { ok: false, error: "invalid_url", detail: `Cannot parse "${rawUrl}" as a URL` };
  }
  if (!safeHttpsUrl(upstream.toString())) {
    return {
      ok: false,
      error: "not_https",
      detail: "MCP endpoint must be a public HTTPS URL without embedded credentials",
    };
  }

  // 2. OAuth metadata discovery. The well-known docs live at the origin,
  //    not at the upstream path — so strip the path for discovery.
  const origin = `${upstream.protocol}//${upstream.host}`;
  const metadata = await fetchOAuthMetadata(origin);
  if (!metadata) {
    return {
      ok: false,
      error: "no_oauth_metadata",
      detail: `No /.well-known/oauth-authorization-server or openid-configuration at ${origin}`,
    };
  }

  const authorizationEndpoint = safeHttpsUrl(metadata.authorization_endpoint as string)?.toString();
  const tokenEndpoint = safeHttpsUrl(metadata.token_endpoint as string)?.toString();
  const registrationEndpoint = typeof metadata.registration_endpoint === "string"
    ? safeHttpsUrl(metadata.registration_endpoint)?.toString()
    : undefined;
  if (!authorizationEndpoint || !tokenEndpoint || (metadata.registration_endpoint && !registrationEndpoint)) {
    return { ok: false, error: "no_oauth_metadata", detail: "OAuth metadata contains an unsafe or non-HTTPS endpoint" };
  }
  // RFC 8707 resource indicator. Default to the upstream URL (no trailing
  // slash, no path) — most MCP servers key allowlist lookups off this.
  const resource = origin;

  // 3. MCP shape check (optional, best-effort).
  const serverName = await tryInitialize(upstream.toString());

  // 4. Build the Connector record. id is sluggable from the upstream.
  const id = slugIdFromUrl(rawUrl);
  const auth: ConnectorAuth = {
    kind: "oauth-bearer",
    authorizationEndpoint,
    tokenEndpoint,
    resource,
    clientId: "", // DCR will mint per-user on first authorize
    registrationEndpoint,
  };
  const connector: Connector = {
    id,
    upstream: upstream.toString(),
    description: serverName
      ? `User-added MCP: ${serverName} (${origin})`
      : `User-added MCP at ${origin}`,
    auth,
    shape: "mcp" as ConnectorShape,
    userAdded: true,
    displayName: serverName ?? id,
  };

  return {
    ok: true,
    connector,
    dcrAvailable: !!registrationEndpoint,
    mcpConfirmed: !!serverName,
    serverName: serverName ?? undefined,
  };
}
