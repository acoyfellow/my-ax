import type { Context } from "hono";
import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";

/**
 * Read-only embed of the shared team meeting-notes service ("oatmeal-notes", a
 * separate Access-protected Worker). This engine stays generic: the upstream
 * base URL is injected by the deploy owner via OATMEAL_NOTES_URL and is never
 * hardcoded here. Publishing/managing notes stays on the standalone app; this
 * only mirrors list + detail for the logged-in user.
 *
 * Identity model: my-ax and oatmeal share ONE Cloudflare Access application, so
 * the caller's Access credentials validate at oatmeal too. We forward the user's
 * Access token (the assertion header + the CF_Authorization cookie) so oatmeal
 * resolves the SAME user and applies its own per-user group authorization. We
 * never send a service token or an on-behalf-of claim: oatmeal stays the
 * authority on who may read what.
 */

const UPSTREAM_TIMEOUT_MS = 10_000;

export function registerMeetingsRoutes(app: Hono<AppEnv>) {
  app.get("/api/team/meetings", (c) => proxyGet(c, "/api/meetings"));
  app.get("/api/team/meetings/:id", (c) =>
    proxyGet(c, `/api/meetings/${encodeURIComponent(c.req.param("id"))}`),
  );
}

async function proxyGet(c: Context<AppEnv>, upstreamPath: string): Promise<Response> {
  const command = `GET /api/team${upstreamPath.slice("/api".length)}`;
  const base = c.env.OATMEAL_NOTES_URL?.trim().replace(/\/+$/, "");
  if (!base) {
    return c.json<ApiResponse>({
      ok: false,
      command,
      error: { code: "NOT_CONFIGURED", message: "Team meeting notes are not configured for this deployment." },
      next_actions: [],
    }, 503);
  }

  const headers: Record<string, string> = { accept: "application/json", "X-Requested-With": "xmlhttprequest" };
  const assertion = c.req.header("Cf-Access-Jwt-Assertion");
  if (assertion) headers["Cf-Access-Jwt-Assertion"] = assertion;
  const cfAuth = readCookie(c.req.header("Cookie"), "CF_Authorization");
  if (cfAuth) headers["cookie"] = `CF_Authorization=${cfAuth}`;

  let res: Response;
  try {
    res = await fetch(`${base}${upstreamPath}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return c.json<ApiResponse>({
      ok: false,
      command,
      error: {
        code: "UPSTREAM_UNREACHABLE",
        message: timedOut ? "Team meeting notes service timed out." : "Team meeting notes service is unreachable.",
      },
      next_actions: [],
    }, 502);
  }

  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const upstreamMsg =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Upstream responded ${res.status}.`;
    // Pass through the auth/not-found signals; collapse everything else to 502.
    const status = res.status === 401 ? 401
      : res.status === 403 ? 403
      : res.status === 404 ? 404
      : res.status === 400 ? 400
      : 502;
    return c.json<ApiResponse>({
      ok: false,
      command,
      error: { code: `UPSTREAM_${res.status}`, message: upstreamMsg },
      next_actions: [],
    }, status);
  }

  return c.json<ApiResponse>({ ok: true, command, result: data ?? {}, next_actions: [] });
}

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
