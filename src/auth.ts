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
  ENVIRONMENT?: string;      // "dev" bypasses verification with DEV_USER_EMAIL
  DEV_USER_EMAIL?: string;
  DEV_USER_GROUPS?: string;  // comma-separated
}

// Module-level JWKS cache. Access JWKS keys rotate; jose handles caching+refresh.
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS(iss: string) {
  if (!jwksCache) {
    jwksCache = createRemoteJWKSet(new URL(`${iss}/cdn-cgi/access/certs`));
  }
  return jwksCache;
}

export async function verifyAccessRequest(
  req: Request,
  env: AuthEnv,
): Promise<AccessIdentity> {
  // Local dev bypass — same pattern as seal/AGENTS.md (slip from cto-agent recon).
  // Only fires when ENVIRONMENT=dev AND iss/aud are empty AND a dev email is set.
  if (
    env.ENVIRONMENT === "dev" &&
    !env.CF_ACCESS_ISS &&
    !env.CF_ACCESS_AUD &&
    env.DEV_USER_EMAIL
  ) {
    return {
      email: env.DEV_USER_EMAIL.toLowerCase(),
      sub: `dev-${env.DEV_USER_EMAIL}`,
      groups: env.DEV_USER_GROUPS?.split(",").map((s) => s.trim()),
    };
  }

  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new AccessError("NoAccessJwt", "Missing Cf-Access-Jwt-Assertion header");

  try {
    const { payload } = await jwtVerify(token, getJWKS(env.CF_ACCESS_ISS), {
      issuer: env.CF_ACCESS_ISS,
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
