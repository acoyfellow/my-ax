import type { MiddlewareHandler } from "hono";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type OriginVerdict = { allowed: true } | { allowed: false; reason: string };

export function originVerdict(request: { method: string; url: string; headers: Headers }, trustedOrigins: readonly string[]): OriginVerdict {
  const isUpgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket";
  if (SAFE_METHODS.has(request.method.toUpperCase()) && !isUpgrade) return { allowed: true };
  const self = new URL(request.url).origin;
  const trusted = new Set([self, ...trustedOrigins]);
  const origin = request.headers.get("origin");
  if (origin && origin !== "null" && !trusted.has(origin)) return { allowed: false, reason: `origin ${origin} is not this app` };
  if (origin === "null") return { allowed: false, reason: "opaque origin" };
  const site = request.headers.get("sec-fetch-site");
  if (!origin && site === "cross-site") return { allowed: false, reason: "cross-site request" };
  return { allowed: true };
}

export function requestOriginGuard(trustedOrigins: (env: unknown) => readonly string[]): MiddlewareHandler {
  return async (c, next) => {
    const verdict = originVerdict(c.req.raw, trustedOrigins(c.env));
    if (!verdict.allowed) {
      return c.json({ ok: false, command: c.req.path, error: { code: "CROSS_SITE_REQUEST", message: `Refused a cross-site request: ${verdict.reason}` }, next_actions: [] }, 403);
    }
    await next();
  };
}

export function bridgeOrigins(env: unknown): string[] {
  const base = (env as { BRIDGE_BASE_URL?: string }).BRIDGE_BASE_URL;
  if (!base) return [];
  try {
    return [new URL(base).origin];
  } catch {
    return [];
  }
}
