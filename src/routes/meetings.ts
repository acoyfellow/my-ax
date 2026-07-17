import type { Context } from "hono";
import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import type { ApiResponse } from "../types";

/**
 * Embed of the shared team meeting-notes service ("oatmeal-notes", a separate
 * Access-protected Worker). This engine stays generic: the upstream base URL is
 * injected by the deploy owner via OATMEAL_NOTES_URL and is never hardcoded
 * here. Reading (list + detail) mirrors the logged-in user's view; publishing
 * (POST) forwards to oatmeal, which stays the authority on who may publish.
 *
 * Identity model: my-ax and oatmeal share ONE Cloudflare Access application, so
 * the caller's Access credentials validate at oatmeal too. We forward the user's
 * Access token (the assertion header + the CF_Authorization cookie) so oatmeal
 * resolves the SAME user and applies its own per-user group authorization. We
 * never send a service token or an on-behalf-of claim: oatmeal stays the
 * authority on who may read/publish what. The forwarded assertion header is also
 * what satisfies oatmeal's state-change guard on POST.
 */

const UPSTREAM_TIMEOUT_MS = 10_000;
// Publishing runs Workers AI regeneration upstream, which is slower than a read.
const UPSTREAM_WRITE_TIMEOUT_MS = 60_000;
// Guard against oversized bodies before we spend an upstream round-trip. Mirrors
// oatmeal's own raw_doc_markdown ceiling (500k) plus headroom for JSON envelope.
const MAX_BODY_BYTES = 600_000;

export function registerMeetingsRoutes(app: Hono<AppEnv>) {
  app.get("/api/team/meetings", (c) => proxyGet(c, "/api/meetings"));
  app.get("/api/team/meetings/:id", (c) =>
    proxyGet(c, `/api/meetings/${encodeURIComponent(c.req.param("id"))}`),
  );
  // Publish. Read-only clients never hit this; oatmeal enforces AX-member authz.
  app.post("/api/team/meetings", (c) => proxyPost(c, "/api/meetings"));
}

/** Resolve the configured upstream base, or return a 503 envelope if unset. */
function upstreamBase(c: Context<AppEnv>, command: string): string | Response {
  const base = c.env.OATMEAL_NOTES_URL?.trim().replace(/\/+$/, "");
  if (!base) {
    return c.json<ApiResponse>({
      ok: false,
      command,
      error: { code: "NOT_CONFIGURED", message: "Team meeting notes are not configured for this deployment." },
      next_actions: [],
    }, 503);
  }
  return base;
}

/** Forward the caller's Access credentials so oatmeal resolves the same user. */
function forwardAuthHeaders(c: Context<AppEnv>, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "X-Requested-With": "xmlhttprequest",
    ...extra,
  };
  const assertion = c.req.header("Cf-Access-Jwt-Assertion");
  if (assertion) headers["Cf-Access-Jwt-Assertion"] = assertion;
  const cfAuth = readCookie(c.req.header("Cookie"), "CF_Authorization");
  if (cfAuth) headers["cookie"] = `CF_Authorization=${cfAuth}`;
  return headers;
}

async function proxyPost(c: Context<AppEnv>, upstreamPath: string): Promise<Response> {
  const command = `POST /api/team${upstreamPath.slice("/api".length)}`;
  const base = upstreamBase(c, command);
  if (base instanceof Response) return base;

  // Oatmeal requires the Access assertion header on state changes; without it the
  // upstream fails closed. Surface that clearly instead of a confusing 403.
  if (!c.req.header("Cf-Access-Jwt-Assertion")) {
    return c.json<ApiResponse>({
      ok: false,
      command,
      error: { code: "MISSING_ASSERTION", message: "Publishing requires a Cloudflare Access session." },
      next_actions: [],
    }, 403);
  }

  const raw = await c.req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return c.json<ApiResponse>({
      ok: false,
      command,
      error: { code: "PAYLOAD_TOO_LARGE", message: "Meeting notes are too large to publish." },
      next_actions: [],
    }, 413);
  }

  let res: Response;
  try {
    res = await fetch(`${base}${upstreamPath}`, {
      method: "POST",
      headers: forwardAuthHeaders(c, { "content-type": "application/json" }),
      body: raw,
      signal: AbortSignal.timeout(UPSTREAM_WRITE_TIMEOUT_MS),
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
  if (!res.ok) return upstreamError(c, command, res, data);
  return c.json<ApiResponse>({ ok: true, command, result: data ?? {}, next_actions: [] }, 201);
}

async function proxyGet(c: Context<AppEnv>, upstreamPath: string): Promise<Response> {
  const command = `GET /api/team${upstreamPath.slice("/api".length)}`;
  const base = upstreamBase(c, command);
  if (base instanceof Response) return base;

  let res: Response;
  try {
    res = await fetch(`${base}${upstreamPath}`, {
      method: "GET",
      headers: forwardAuthHeaders(c),
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
  if (!res.ok) return upstreamError(c, command, res, data);
  return c.json<ApiResponse>({ ok: true, command, result: data ?? {}, next_actions: [] });
}

/**
 * Map an upstream oatmeal error response to our envelope. Auth/not-found/conflict
 * and validation signals pass through; everything else collapses to 502 so we
 * never leak an unexpected upstream status shape to clients.
 */
function upstreamError(c: Context<AppEnv>, command: string, res: Response, data: unknown): Response {
  const rawError =
    data && typeof data === "object" && "error" in data ? (data as { error: unknown }).error : undefined;
  const upstreamMsg = typeof rawError === "string" ? rawError : `Upstream responded ${res.status}.`;
  const status = [400, 401, 403, 404, 409].includes(res.status) ? res.status : 502;
  // oatmeal returns { error, id } on a 409 dedup; preserve the existing id so the
  // client can link straight to the already-published meeting.
  const existingId =
    res.status === 409 && data && typeof data === "object" && "id" in data
      ? (data as { id?: unknown }).id
      : undefined;
  return c.json<ApiResponse>({
    ok: false,
    command,
    error: { code: `UPSTREAM_${res.status}`, message: upstreamMsg },
    result: typeof existingId === "string" ? { id: existingId } : undefined,
    next_actions: [],
  }, status as 400 | 401 | 403 | 404 | 409 | 502);
}

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
