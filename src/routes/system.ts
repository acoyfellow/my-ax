// routes/system.ts — periodic durability check.
//
//   POST /api/system/workspace-restore-probe
//     writes a unique nonce to /home/user/.my-ax/restore-probe.txt,
//     forces snapshot+destroy+restore, reads it back, returns ok iff
//     the byte-compare matched. The proof/plan.ts smoke calls this on
//     every CI run so we catch silent R2/snapshot regressions before
//     a user does.
//
// Not in routes/files.ts because that's user-facing read-only API;
// this is an operator check that takes ~20s and recycles the sandbox.

import { SESSION_SQL, sessionWrite, type SessionStoreDb } from "../domain/Session/Session.store";
import type { Hono } from "hono";
import { dailyRefusals, flushRefusals } from "../domain/refusals";
import { createDecision } from "./decisions";
import { createSvelteArtifact } from "../artifacts";
import { seedPiChatEntries } from "../pi-engine/routes";
import { emptyUsage } from "../pi-engine/think-convert";
import type { AppEnv } from "../app-env";
import { dismissAttentionItem, type AttentionStoreDb } from "../domain/Attention/Attention.store";
import { seedUserWorkspaceFile } from "../workspace";
import type { ApiResponse } from "../types";
import { recordRecoveryExhaustion } from "../recovery-exhaustion";

export function registerSystemRoutes(app: Hono<AppEnv>) {
  app.post("/api/system/decision-probe", async (c) => {
    const command = "POST /api/system/decision-probe";
    const email = c.get("identity").email.toLowerCase();
    const body = await c.req.json<{ sessionId?: string; question?: string; options?: string[] }>().catch(() => ({} as { sessionId?: string; question?: string; options?: string[] }));
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const owned = sessionId ? await c.env.DB.prepare("SELECT name FROM sessions WHERE id = ? AND owner_email = ?").bind(sessionId, email).first<{ name: string }>() : null;
    if (!owned?.name?.startsWith("decision-inline-")) return c.json<ApiResponse>({ ok: false, command, error: { code: "NotFound", message: "probe sessions must be named decision-inline-*" }, next_actions: [] }, 404);
    const question = (body.question ?? "").slice(0, 200) || "Probe decision?";
    const options = Array.isArray(body.options) ? body.options.map(String).slice(0, 4) : ["Yes", "No"];
    const decision = await createDecision(c.env, email, sessionId, question, options);
    const result = JSON.stringify({ ok: true, awaiting: true, decisionId: decision.id, href: decision.href, options });
    const now = Date.now();
    const toolCallId = `probe-${decision.id}`;
    await seedPiChatEntries(c.env, email, sessionId, [
      { kind: "pi.user", model: [{ role: "user", content: "Decision probe: ask me to choose.", timestamp: now - 2000 }] },
      { kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "toolCall", id: toolCallId, name: "ask_user", arguments: { question, options } }], api: "imported", provider: "imported", model: "probe", usage: emptyUsage(), stopReason: "toolUse", timestamp: now - 1000 }] },
      { kind: "pi.tool-result", model: [{ role: "toolResult", toolCallId, toolName: "ask_user", content: [{ type: "text", text: result }], isError: false, timestamp: now }] },
    ]);
    return c.json<ApiResponse>({ ok: true, command, result: { decisionId: decision.id, href: decision.href }, next_actions: [] }, 201);
  });
  app.post("/api/system/dev-widget", async (c) => {
    const command = "POST /api/system/dev-widget";
    if (c.env.ENVIRONMENT !== "dev") return c.json<ApiResponse>({ ok: false, command, error: { code: "NotFound", message: "dev only" }, next_actions: [] }, 404);
    const body = await c.req.json<{ sessionId?: string; title?: string; source?: string }>().catch(() => ({} as { sessionId?: string; title?: string; source?: string }));
    if (!body.sessionId || !body.source) return c.json<ApiResponse>({ ok: false, command, error: { code: "BadRequest", message: "sessionId and source required" }, next_actions: [] }, 400);
    const result = await createSvelteArtifact(c.env, c.get("identity"), body.sessionId, { title: body.title ?? "dev widget", source: body.source });
    return c.json<ApiResponse>({ ok: true, command, result, next_actions: [] }, 201);
  });
  app.post("/api/system/dev-seed-steps", async (c) => {
    const command = "POST /api/system/dev-seed-steps";
    if (c.env.ENVIRONMENT !== "dev") return c.json<ApiResponse>({ ok: false, command, error: { code: "NotFound", message: "dev only" }, next_actions: [] }, 404);
    const email = c.get("identity").email.toLowerCase();
    const { sessionId } = await c.req.json<{ sessionId?: string }>().catch(() => ({} as { sessionId?: string }));
    if (!sessionId) return c.json<ApiResponse>({ ok: false, command, error: { code: "BadRequest", message: "sessionId required" }, next_actions: [] }, 400);
    const now = Date.now();
    const commands = ["tail -n 40 ~/.pi/agent/logs/pi.log", "ps aux | grep cloudflared", "sleep 5; cloudflared access token -app=https://example.test", "sleep 5; cloudflared access login https://example.test"];
    const assistant = commands.flatMap((command, index) => [
      { type: "toolCall", id: `seed-${index}`, name: "exec", arguments: { command } },
      { type: "toolCall", id: `seed-read-${index}`, name: "read_file", arguments: { path: `/home/user/notes/${index}.txt` } },
      { type: "thinking", thinking: `Step ${index + 1}: the login has not gone through yet, so check again.` },
    ]);
    await seedPiChatEntries(c.env, email, sessionId, [
      { kind: "pi.user", model: [{ role: "user", content: "Log in to Cloudflare Access for me.", timestamp: now - 9000 }] },
      { kind: "pi.assistant", model: [{ role: "assistant", content: [...assistant, { type: "text", text: "The login hasn't gone through. Cloudflare hasn't told it you approved it yet." }], api: "imported", provider: "imported", model: "probe", usage: emptyUsage(), stopReason: "stop", timestamp: now - 5000 }] },
      ...commands.flatMap((_, index) => [
        { kind: "pi.tool-result", model: [{ role: "toolResult", toolCallId: `seed-${index}`, toolName: "exec", content: [{ type: "text", text: `ok ${index + 1}` }], isError: false, timestamp: now - 4000 + index }] },
        { kind: "pi.tool-result", model: [{ role: "toolResult", toolCallId: `seed-read-${index}`, toolName: "read_file", content: [{ type: "text", text: "notes" }], isError: false, timestamp: now - 3900 + index }] },
      ]),
    ]);
    return c.json<ApiResponse>({ ok: true, command, result: { sessionId }, next_actions: [] }, 201);
  });
  app.post("/api/system/dev-seed-decision", async (c) => {
    const command = "POST /api/system/dev-seed-decision";
    if (c.env.ENVIRONMENT !== "dev") return c.json<ApiResponse>({ ok: false, command, error: { code: "NotFound", message: "dev only" }, next_actions: [] }, 404);
    const email = c.get("identity").email.toLowerCase();
    const { sessionId } = await c.req.json<{ sessionId?: string }>().catch(() => ({} as { sessionId?: string }));
    if (!sessionId) return c.json<ApiResponse>({ ok: false, command, error: { code: "BadRequest", message: "sessionId required" }, next_actions: [] }, 400);
    const question = "Ship the fix now?";
    const options = ["Yes", "No"];
    const decision = await createDecision(c.env, email, sessionId, question, options);
    const now = Date.now();
    await seedPiChatEntries(c.env, email, sessionId, [
      { kind: "pi.user", model: [{ role: "user", content: "Ask me before shipping.", timestamp: now - 5000 }] },
      { kind: "pi.assistant", model: [{ role: "assistant", content: [{ type: "toolCall", id: "seed-ask", name: "ask_user", arguments: { question, options } }], api: "seed", provider: "seed", model: "seed", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: now - 4000 }] },
      { kind: "pi.tool-result", model: [{ role: "toolResult", toolCallId: "seed-ask", toolName: "ask_user", content: [{ type: "text", text: JSON.stringify({ ok: true, decisionId: decision.id, options, href: decision.href }) }], isError: false, timestamp: now - 3000 }] },
    ]);
    return c.json<ApiResponse>({ ok: true, command, result: { sessionId, decisionId: decision.id }, next_actions: [] }, 201);
  });
  app.get("/api/domain/refusals", async (c) => {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query("day") ?? "") ? String(c.req.query("day")) : new Date().toISOString().slice(0, 10);
    await flushRefusals(c.env.DB);
    const counts = await dailyRefusals(c.env.DB, day);
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return c.json<ApiResponse>({ ok: true, command: "GET /api/domain/refusals", result: { day, total, counts }, next_actions: [] });
  });
  app.post("/api/system/recovery-exhaustion-probe", async (c) => {
    const identity = c.get("identity");
    const sessionId = `recovery-proof-${crypto.randomUUID()}`;
    const terminalMessage = "Controlled recovery exhaustion proof.";
    let attentionId: string | null = null;
    const started = Date.now();
    try {
      await sessionWrite(c.env.DB as unknown as SessionStoreDb, SESSION_SQL.S10_OPEN, [sessionId, "Recovery receipt proof", identity.email]);
      await recordRecoveryExhaustion(c.env, identity, sessionId, {
        terminalMessage,
        incidentId: `proof-${crypto.randomUUID()}`,
        reason: "controlled production proof",
        proof: true,
      });
      const session = await c.env.DB.prepare("SELECT status FROM sessions WHERE id = ? AND owner_email = ?")
        .bind(sessionId, identity.email).first<{ status: string }>();
      const transcript = await c.env.DB.prepare("SELECT content, meta_json FROM conversation_entries WHERE session_id = ? AND owner_email = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1")
        .bind(sessionId, identity.email).first<{ content: string; meta_json: string | null }>();
      const attention = await c.env.DB.prepare("SELECT id, title, body, href FROM attention_items WHERE session_id = ? AND owner_email = ? AND kind = 'session.update' ORDER BY created_at DESC LIMIT 1")
        .bind(sessionId, identity.email).first<{ id: string; title: string; body: string; href: string }>();
      attentionId = attention?.id ?? null;
      const meta = transcript?.meta_json ? JSON.parse(transcript.meta_json) as { status?: string } : null;
      const ok = session?.status === "interrupted" && transcript?.content === terminalMessage && meta?.status === "interrupted" && attention?.title === "Recovery receipt proof" && attention.href === `/?session=${encodeURIComponent(sessionId)}`;
      return c.json<ApiResponse>({
        ok,
        command: c.req.path,
        result: { sessionStatus: session?.status, transcriptStatus: meta?.status, attentionTitle: attention?.title, attentionHref: attention?.href, durationMs: Date.now() - started },
        error: ok ? undefined : { code: "RECOVERY_EXHAUSTION_PROOF_MISMATCH", message: "Recovery exhaustion side effects did not match the owner-visible contract" },
        next_actions: [],
      }, ok ? 200 : 500);
    } catch (err) {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "RECOVERY_EXHAUSTION_PROOF_FAILED", message: err instanceof Error ? err.message : String(err) }, result: { durationMs: Date.now() - started }, next_actions: [] }, 500);
    } finally {
      if (attentionId) await dismissAttentionItem(c.env.DB as unknown as AttentionStoreDb, identity.email, attentionId).catch(() => undefined);
      await c.env.DB.prepare("DELETE FROM conversation_entries WHERE session_id = ? AND owner_email = ?").bind(sessionId, identity.email).run().catch(() => undefined);
      await sessionWrite(c.env.DB as unknown as SessionStoreDb, SESSION_SQL.S02_DELETE, [sessionId, identity.email]).catch(() => undefined);
    }
  });

  app.post("/api/system/workspace-restore-probe", async (c) => {
    const identity = c.get("identity");
    const body = await c.req.json<{ target?: unknown }>().catch((): { target?: unknown } => ({}));
    const target = body?.target;
    if (target !== undefined && target !== "default" && target !== "node_modules") {
      return c.json<ApiResponse>({
        ok: false,
        command: c.req.path,
        error: { code: "INVALID_PROBE_TARGET", message: "Probe target must be \"default\" or \"node_modules\"" },
        next_actions: [],
      }, 400);
    }

    const nonce = crypto.randomUUID();
    const probe = target === "node_modules"
      ? {
          path: `/home/user/node_modules/.my-ax-restore-probe/${crypto.randomUUID()}.txt`,
          content: `node-modules-restore:${nonce}`,
        }
      : {
          path: "/home/user/.my-ax/restore-probe.txt",
          content: nonce,
        };
    const started = Date.now();
    try {
      const result = await seedUserWorkspaceFile(c.env, identity, probe);
      return c.json<ApiResponse>({
        ok: result.restoreMatches,
        command: c.req.path,
        result: {
          path: result.path,
          bytesWritten: result.bytesWritten,
          snapshotId: result.snapshot.id,
          restoreMatches: result.restoreMatches,
          durationMs: Date.now() - started,
        },
        error: result.restoreMatches
          ? undefined
          : { code: "WORKSPACE_RESTORE_MISMATCH", message: "Restored probe content did not match written nonce" },
        next_actions: [],
      }, result.restoreMatches ? 200 : 500);
    } catch (err) {
      return c.json<ApiResponse>(
        {
          ok: false,
          command: c.req.path,
          error: {
            code: "WORKSPACE_RESTORE_PROBE_FAILED",
            message: err instanceof Error ? err.message : String(err),
          },
          result: { durationMs: Date.now() - started },
          next_actions: [],
        },
        500,
      );
    }
  });
}
