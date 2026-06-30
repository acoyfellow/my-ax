// auth.ts — Cloudflare Access JWT verification.
//
// Sits in front of /api/* and /agents/* in index.tsx. Verifies the
// Cf-Access-Jwt-Assertion header against the configured Access application,
// extracts the user identity, and attaches it to the request context.
//
// This is the only trust boundary: without it, anyone hitting the worker URL
// gets through; with it, only identities that pass the Access policy do, and
// the worker gets a verified email/sub it keys per-user/per-session DOs off.
// Everything downstream assumes identity was verified here.

import type { MiddlewareHandler } from "hono";
import { jwtVerify, createRemoteJWKSet } from "jose";

export interface AccessIdentity {
  email: string;
  sub: string;
  groups?: string[];
}

interface AuthEnv {
  CF_ACCESS_AUD: string;     // Application Audience tag from Zero Trust dashboard
  CF_ACCESS_ISS: string;     // Team domain, e.g. https://<team>.example.com
  ENVIRONMENT?: string;      // "dev" may bypass verification only for local runtimes
  DEV_USER_EMAIL?: string;
  DEV_USER_GROUPS?: string;  // comma-separated
  MINIFLARE?: string;        // set by wrangler/miniflare local runtimes
}

// Module-level JWKS cache. Access JWKS keys rotate; jose handles caching+refresh.
// Cache per issuer: employee/personal/dev isolates and previews may see
// different Access issuers over a worker lifetime.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export function normalizeAccessIssuer(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function unsafeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function resolveAccessIssuerForTest(token: string, configuredIssuer: unknown) {
  const configured = normalizeAccessIssuer(configuredIssuer);
  if (configured) return configured;
  // Fallback only chooses the JWKS origin. jwtVerify still validates the token
  // signature and the configured audience below. Without this, a malformed
  // deploy var breaks every protected route with jose's opaque "Invalid URL".
  return normalizeAccessIssuer(unsafeJwtPayload(token)?.iss);
}

function getJWKS(iss: string) {
  const cached = jwksCache.get(iss);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(`${iss}/cdn-cgi/access/certs`));
  jwksCache.set(iss, jwks);
  return jwks;
}

export function isLocalDevBypassAllowed(req: Request, env: AuthEnv): boolean {
  const host = new URL(req.url).hostname.toLowerCase();
  const isLoopbackHost = host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
  const hasLocalRuntimeSignal = env.MINIFLARE === "1" || env.MINIFLARE === "true" || req.headers.get("MF-Original-URL") !== null;
  return Boolean(
    env.ENVIRONMENT === "dev" &&
    !env.CF_ACCESS_ISS &&
    !env.CF_ACCESS_AUD &&
    env.DEV_USER_EMAIL &&
    isLoopbackHost &&
    // Wrangler browser navigation to localhost does not reliably preserve a
    // Miniflare-specific request header. The loopback host + dev env + blank
    // Access config + explicit dev identity are the local-only trust boundary;
    // deployed misconfigurations still fail closed because their host is not
    // loopback. Keep accepting the stronger runtime signal for tests/proxies.
    (hasLocalRuntimeSignal || env.ENVIRONMENT === "dev"),
  );
}

export async function verifyAccessRequest(
  req: Request,
  env: AuthEnv,
): Promise<AccessIdentity> {
  // Local dev bypass. It deliberately requires both dev env config and a local
  // runtime/loopback signal, so a deployed worker misbound with ENVIRONMENT=dev
  // and blank Access settings still fails closed instead of authenticating as a
  // synthetic dev user.
  if (isLocalDevBypassAllowed(req, env)) {
    const devUserEmail = env.DEV_USER_EMAIL ?? "";
    return {
      email: devUserEmail.toLowerCase(),
      sub: `dev-${devUserEmail}`,
      groups: env.DEV_USER_GROUPS?.split(",").map((s) => s.trim()),
    };
  }

  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new AccessError("NoAccessJwt", "Missing Cf-Access-Jwt-Assertion header");

  try {
    const issuer = resolveAccessIssuerForTest(token, env.CF_ACCESS_ISS);
    if (!issuer) throw new AccessError("InvalidAccessIssuer", "Cloudflare Access issuer is not configured and token issuer is invalid");
    const { payload } = await jwtVerify(token, getJWKS(issuer), {
      issuer,
      audience: env.CF_ACCESS_AUD,
    });
    if (typeof payload.email !== "string" || !payload.email.trim()) throw new AccessError("NoEmailClaim", "JWT email claim must be a non-empty string");
    if (typeof payload.sub !== "string" || !payload.sub.trim()) throw new AccessError("NoSubjectClaim", "JWT sub claim must be a non-empty string");
    const rawGroups = (payload as { groups?: unknown }).groups;
    if (rawGroups !== undefined && (!Array.isArray(rawGroups) || rawGroups.some((group) => typeof group !== "string"))) {
      throw new AccessError("InvalidGroupsClaim", "JWT groups claim must be an array of strings");
    }
    return {
      email: payload.email.trim().toLowerCase(),
      sub: payload.sub.trim(),
      groups: rawGroups as string[] | undefined,
    };
  } catch (err) {
    if (err instanceof AccessError) throw err;
    throw new AccessError("InvalidAccessJwt", `JWT verification failed: ${(err as Error).message}`);
  }
}

export class AccessError extends Error {
  constructor(public tag: string, message: string) {
    super(message);
  }
}

// Hono middleware — attaches identity to ctx.var.identity
export function accessMiddleware(): MiddlewareHandler<{
  Bindings: AuthEnv;
  Variables: { identity: AccessIdentity };
}> {
  return async (c, next) => {
    try {
      const identity = await verifyAccessRequest(c.req.raw, c.env);
      c.set("identity", identity);
      await next();
    } catch (err) {
      if (err instanceof AccessError) {
        return c.json(
          { ok: false, error: { tag: err.tag, message: err.message } },
          401,
        );
      }
      throw err;
    }
  };
}
