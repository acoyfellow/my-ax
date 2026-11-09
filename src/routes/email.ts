import type { Hono } from "hono";
import type { ApiResponse } from "../types";
import type { AppEnv } from "../app-env";
import { emailEnabled, sendEmail } from "../email-in";

export function registerEmailRoutes(app: Hono<AppEnv>) {
  app.get("/api/emails", async (c) => {
    const identity = c.get("identity");
    const rows = await c.env.DB.prepare(
      "SELECT id, from_addr, to_addr, subject, body, created_at, read_at FROM emails WHERE owner_email = ? ORDER BY created_at DESC LIMIT 50",
    ).bind(identity.email.toLowerCase()).all();
    return c.json<ApiResponse>({
      ok: true,
      command: "GET /api/emails",
      result: { emails: rows.results ?? [] },
      next_actions: [],
    });
  });

  app.post("/api/emails/send", async (c) => {
    if (!emailEnabled(c.env)) {
      return c.json<ApiResponse>({
        ok: false,
        command: "POST /api/emails/send",
        error: { code: "EMAIL_DISABLED", message: "Email sending is disabled (EMAIL_ENABLED is not 1)" },
        next_actions: [],
      }, 503);
    }
    const body: { to?: unknown; subject?: unknown; body?: unknown } = await c.req.json().catch(() => ({}));
    const to = typeof body.to === "string" ? body.to.trim() : "";
    const subject = typeof body.subject === "string" ? body.subject.slice(0, 200) : "";
    const text = typeof body.body === "string" ? body.body.slice(0, 50_000) : "";
    if (!to || !subject || !text) {
      return c.json<ApiResponse>({
        ok: false,
        command: "POST /api/emails/send",
        error: { code: "INVALID_EMAIL", message: "to, subject and body are required" },
        next_actions: [],
      }, 400);
    }
    const sent = await sendEmail(c.env, { to, subject, body: text });
    if (!sent.ok) {
      return c.json<ApiResponse>({
        ok: false,
        command: "POST /api/emails/send",
        error: { code: "SEND_FAILED", message: sent.error ?? "send failed" },
        next_actions: [],
      }, 502);
    }
    return c.json<ApiResponse>({
      ok: true,
      command: "POST /api/emails/send",
      result: { sentTo: to },
      next_actions: [],
    });
  });
}
