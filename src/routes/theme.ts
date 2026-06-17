// routes/theme.ts — theme preference cookie + endpoint.
//
// The `myax-theme` cookie holds the user's theme preference. The Layout
// SSR helper reads it via readThemeCookie() so the html element ships
// with the right class on first paint (avoids a FOUC/anti-flash flicker).
//
// Single mutation endpoint: POST /api/preferences/theme.

import type { Hono } from "hono";
import type { AppEnv } from "../app-env";

export type ThemePref = "light" | "dark" | "system";

export function isThemePref(s: string | undefined): s is ThemePref {
  return s === "light" || s === "dark" || s === "system";
}

/** Read the user's theme preference from the cookie. Returns "system" if
 *  the cookie is missing or malformed — that's the safe default because
 *  "system" lets the anti-flash JS resolve from matchMedia. */
export function readThemeCookie(c: { req: { header: (n: string) => string | undefined } }): ThemePref {
  const raw = c.req.header("cookie") || "";
  // No need to import a cookie parser for one value. Multiple
  // `myax-theme=` entries → last one wins (matches browser behavior).
  const matches = raw.match(/(?:^|;\s*)myax-theme=(light|dark|system)(?:;|$)/g);
  if (!matches || matches.length === 0) return "system";
  const last = matches[matches.length - 1];
  const val = last.split("=")[1]?.split(";")[0];
  return isThemePref(val) ? val : "system";
}

/** Build the Set-Cookie header value for persisting a theme preference.
 *  Two-year expiry — long enough that no one ever has to set it twice. */
export function themeCookieHeader(value: ThemePref): string {
  const TWO_YEARS = 60 * 60 * 24 * 365 * 2;
  return `myax-theme=${value}; Path=/; Max-Age=${TWO_YEARS}; SameSite=Lax`;
}

// POST /api/preferences/theme  body: { value: "light" | "dark" | "system" }
//
// Writes the `myax-theme` cookie. Returns 204 No Content on success so the
// client doesn't waste a parse on an empty body. Idempotent.
//
// The client updates the <html> class in JS immediately after a successful
// response; the cookie is the server-side source of truth for the next SSR.
// A light-mode toggle round-trip looks like:
//
//   1. user clicks "Light" pill in Settings
//   2. JS sends POST /api/preferences/theme { value: "light" }
//   3. server replies 204 + Set-Cookie
//   4. JS does document.documentElement.classList = "light"
//   5. JS updates <meta name="theme-color"> to #ffffff
//   6. (later) user reloads → SSR reads cookie → ships <html class="light">
//      → anti-flash script no-ops because class already set → no flicker.
export function registerThemeRoutes(app: Hono<AppEnv>) {
  app.post("/api/preferences/theme", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const value =
      typeof body === "object" && body !== null && "value" in body
        ? (body as { value: unknown }).value
        : undefined;
    if (typeof value !== "string" || !isThemePref(value)) {
      return c.json(
        { ok: false, error: "value must be one of: light, dark, system" },
        400,
      );
    }
    return new Response(null, {
      status: 204,
      headers: { "Set-Cookie": themeCookieHeader(value) },
    });
  });
}
