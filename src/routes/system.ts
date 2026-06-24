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

import type { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { seedUserWorkspaceFile } from "../workspace";
import type { ApiResponse } from "../types";
import { recordRecoveryExhaustion } from "../recovery-exhaustion";

export function registerSystemRoutes(app: Hono<AppEnv>) {
  app.post("/api/system/recovery-exhaustion-probe", async (c) => {
    const identity = c.get("identity");
    const sessionId = `recovery-proof-${crypto.randomUUID()}`;
    const terminalMessage = "Controlled recovery exhaustion proof.";
    let attentionId: string | null = null;
    const started = Date.now();
    try {
      await c.env.DB.prepare("INSERT INTO sessions (id, name, status, owner_email) VALUES (?, ?, 'running', ?)")
        .bind(sessionId, "Recovery receipt proof", identity.email)
        .run();
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
      if (attentionId) await c.env.DB.prepare("DELETE FROM attention_items WHERE id = ? AND owner_email = ?").bind(attentionId, identity.email).run().catch(() => undefined);
      await c.env.DB.prepare("DELETE FROM conversation_entries WHERE session_id = ? AND owner_email = ?").bind(sessionId, identity.email).run().catch(() => undefined);
      await c.env.DB.prepare("DELETE FROM sessions WHERE id = ? AND owner_email = ?").bind(sessionId, identity.email).run().catch(() => undefined);
    }
  });

  app.post("/api/system/workspace-restore-probe", async (c) => {
    const identity = c.get("identity");
    const nonce = crypto.randomUUID();
    const started = Date.now();
    try {
      const result = await seedUserWorkspaceFile(c.env, identity, {
        path: "/home/user/.my-ax/restore-probe.txt",
        content: nonce,
      });
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
