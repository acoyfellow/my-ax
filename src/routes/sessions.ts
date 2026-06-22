import type { Hono } from "hono";
import type { ApiResponse } from "../types";
import type { AppEnv } from "../app-env";
import { getConnector, type ConnectorId } from "../connectors";
import { makeOAuthClientStore } from "../oauth-store";
import { mintBridgeTicket } from "../bridge";
import { clampEntriesLimit, pageConversationEntries, parseEntriesCursor, type ConversationEntryRow } from "../session-entries";
import { getSessionAgent } from "../agent-stub";
import { deleteSessionArtifacts } from "../artifacts";
import { cancelJobSchedule, type JobRow } from "../jobs";
import { requireOwnedSession, SessionOwnershipCheckError } from "../session-ownership";

export function registerSessionRoutes(app: Hono<AppEnv>) {
  // ─── Session lifecycle ─────────────────────────────────────────────────────
  // GET /api/sessions?limit=50&before=<iso-utc>
  //   - limit: 1..100 (default 50). Clamped server-side.
  //   - before: keyset cursor — the updated_at of the OLDEST row in the
  //     previous page. Returns rows STRICTLY OLDER than this. The sidebar
  //     "Load more" button passes the last row's updated_at as `before`.
  // Response includes:
  //   result.sessions  — page of rows (newest-first by updated_at)
  //   result.nextCursor — updated_at to use as `before` on the next page,
  //                       or null if we returned fewer than `limit` rows.
  app.get("/api/sessions", async (c) => {
    const url = new URL(c.req.url);
    const limitRaw = parseInt(url.searchParams.get("limit") || "50", 10);
    const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 50));
    const before = url.searchParams.get("before"); // ISO-ish; passed through as-is to D1

    try {
      const query = before
        ? "SELECT id, name, status, created_at, updated_at FROM sessions WHERE owner_email = ? AND updated_at < ? ORDER BY updated_at DESC LIMIT ?"
        : "SELECT id, name, status, created_at, updated_at FROM sessions WHERE owner_email = ? ORDER BY updated_at DESC LIMIT ?";
      const stmt = before
        ? c.env.DB.prepare(query).bind(c.get("identity").email, before, limit)
        : c.env.DB.prepare(query).bind(c.get("identity").email, limit);
      const result = await stmt.all();
      const sessions = result.results as Array<{ updated_at: string }>;
      // Cursor only if we filled the page — otherwise we're at the tail.
      const nextCursor =
        sessions.length === limit ? sessions[sessions.length - 1]?.updated_at ?? null : null;

      return c.json<ApiResponse>({
        ok: true,
        command: "GET /api/sessions",
        result: { sessions, nextCursor, limit },
        next_actions: [
          { command: "POST /api/sessions", description: "Create a new session" },
        ],
      });
    } catch {
      return c.json<ApiResponse>({
        ok: true,
        command: "GET /api/sessions",
        result: { sessions: [], nextCursor: null, limit },
        next_actions: [
          { command: "POST /api/sessions", description: "Create a new session" },
        ],
      });
    }
  });

  // PATCH /api/sessions/:id  { name: string }
  // Rename a conversation. Only the owner can rename their own sessions.
  // Name is trimmed and capped at 200 chars (way longer than the
  // auto-title's 50 since the user is being deliberate). Empty/whitespace
  // is rejected so users can't accidentally clear the title via prompt.
  app.patch("/api/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req
      .json<{ name?: string }>()
      .catch(() => ({}))) as { name?: string };
    const trimmed = (body.name ?? "").trim();
    if (!trimmed) {
      return c.json(
        {
          ok: false,
          command: `PATCH /api/sessions/${id}`,
          error: { tag: "InvalidName", message: "name must be non-empty" },
        },
        400,
      );
    }
    const name = trimmed.slice(0, 200);
    try {
      const r = await c.env.DB.prepare(
        "UPDATE sessions SET name = ?, updated_at = datetime('now') WHERE id = ? AND owner_email = ?",
      )
        .bind(name, id, c.get("identity").email)
        .run();
      if (!r.success || (r.meta?.changes ?? 0) === 0) {
        return c.json(
          {
            ok: false,
            command: `PATCH /api/sessions/${id}`,
            error: { tag: "NotFound", message: "session not found or not owned" },
          },
          404,
        );
      }
    } catch (err) {
      return c.json(
        {
          ok: false,
          command: `PATCH /api/sessions/${id}`,
          error: {
            tag: "DBError",
            message: err instanceof Error ? err.message : String(err),
          },
        },
        500,
      );
    }
    return c.json<ApiResponse>({
      ok: true,
      command: `PATCH /api/sessions/${id}`,
      result: { id, name },
      next_actions: [],
    });
  });

  app.post("/api/sessions", async (c) => {
    const identity = c.get("identity");
    const body = (await c.req.json<{ name?: string; model?: string }>().catch(
      () => ({}),
    )) as { name?: string; model?: string };
    const id = crypto.randomUUID();
    const requestedName = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    const name = requestedName || `Session ${id.slice(0, 8)}`;

    try {
      await c.env.DB.prepare(
        "INSERT INTO sessions (id, name, status, owner_email, created_at, updated_at) VALUES (?, ?, 'active', ?, datetime('now'), datetime('now'))",
      )
        .bind(id, name, identity.email)
        .run();
    } catch {
      // D1 missing in dev; tolerate
    }

    // Seed identity into the native Think agent so owner-scoped workspace,
    // connector, upload, and notification tools run as the verified user.
    try {
      const stub = await getSessionAgent(c.env, identity.email, id);
      await stub.seedIdentity(identity);
    } catch {
      // best-effort; first WS message will also seed
    }

    return c.json<ApiResponse>(
      {
        ok: true,
        command: "POST /api/sessions",
        result: {
          sessionId: id,
          name,
          owner: identity.email,
          wsUrl: `/agents/my-agent/${id}`,
        },
        next_actions: [
          {
            command: `POST /api/sessions/${id}/ticket`,
            description: "Mint a bridge ticket for a connector",
          },
          {
            command: `ws://host/agents/my-agent/${id}`,
            description: "Open the WS for chat",
          },
        ],
      },
      201,
    );
  });

  // Persist the UI-selected model onto the session DO so voice turns (which
  // don't send a request body) use the same model as typed chat.
  app.post("/api/sessions/:id/model", async (c) => {
    const id = c.req.param("id");
    const identity = c.get("identity");
    const body = (await c.req.json<{ model?: string; reasoningEffort?: string }>().catch(() => ({}))) as { model?: string; reasoningEffort?: string };
    if (!body.model) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_REQUEST", message: "model is required" }, next_actions: [] }, 400);
    try {
      if (!(await requireOwnedSession(c.env, id, identity.email))) {
        return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "session not found or not owned" }, next_actions: [] }, 404);
      }
      const stub = await getSessionAgent(c.env, identity.email, id);
      await stub.seedIdentity(identity);
      const result = await stub.setSessionModel(body.model, body.reasoningEffort);
      return c.json<ApiResponse>({ ok: result.ok, command: c.req.path, result, next_actions: [] }, result.ok ? 200 : 400);
    } catch (err) {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "MODEL_SET_FAILED", message: err instanceof Error ? err.message : String(err) }, next_actions: [] }, 500);
    }
  });

  app.post("/api/sessions/:id/fork", async (c) => {
    const sourceId = c.req.param("id");
    const identity = c.get("identity");
    const body: { atMessageId?: string } = await c.req.json<{ atMessageId?: string }>().catch(() => ({}));
    const atMessageId = body.atMessageId?.trim() ?? "";
    if (!atMessageId) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_FORK_POINT", message: "atMessageId is required" }, next_actions: [] }, 400);
    const source = await c.env.DB.prepare("SELECT id, name FROM sessions WHERE id = ? AND owner_email = ?").bind(sourceId, identity.email).first<{ id: string; name: string }>();
    if (!source) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "session not found or not owned" }, next_actions: [] }, 404);
    let forkId: string | null = null;
    try {
      const sourceStub = await getSessionAgent(c.env, identity.email, sourceId);
      await sourceStub.seedIdentity(identity);
      const history = await sourceStub.forkHistoryAt(atMessageId);
      forkId = crypto.randomUUID();
      const forkName = `Fork · ${source.name}`.slice(0, 200);
      await c.env.DB.prepare("INSERT INTO sessions (id, name, status, owner_email, created_at, updated_at) VALUES (?, ?, 'active', ?, datetime('now'), datetime('now'))").bind(forkId, forkName, identity.email).run();
      const forkStub = await getSessionAgent(c.env, identity.email, forkId);
      await forkStub.seedForkHistory(identity, history);
      const cutoff = await c.env.DB.prepare("SELECT id FROM conversation_entries WHERE session_id = ? AND owner_email = ? AND json_extract(meta_json, '$.uiMessageId') = ? ORDER BY id DESC LIMIT 1").bind(sourceId, identity.email, atMessageId).first<{ id: number }>();
      if (cutoff) {
        await c.env.DB.prepare(`INSERT INTO conversation_entries(session_id, owner_email, ts, role, tool, is_error, content, meta_json)
          SELECT ?, owner_email, ts, role, tool, is_error, content, meta_json FROM conversation_entries
          WHERE session_id = ? AND owner_email = ? AND id <= ? ORDER BY id ASC`).bind(forkId, sourceId, identity.email, cutoff.id).run();
      }
      return c.json<ApiResponse>({ ok: true, command: c.req.path, result: { sessionId: forkId, sourceSessionId: sourceId, atMessageId, name: forkName, messageCount: history.length }, next_actions: [] }, 201);
    } catch (error) {
      if (forkId) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ? AND owner_email = ?").bind(forkId, identity.email).run().catch(() => undefined);
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "FORK_FAILED", message: error instanceof Error ? error.message : String(error) }, next_actions: [] }, 409);
    }
  });

  app.delete("/api/sessions/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const email = c.get("identity").email;
      // Cancel native alarms before removing their D1 index rows. Otherwise a
      // deleted session can keep executing recurring prompts from its facet.
      const jobs = await c.env.DB.prepare("SELECT owner_email, session_id, schedule_id FROM jobs WHERE session_id = ? AND owner_email = ?").bind(id, email).all<JobRow>();
      for (const job of jobs.results ?? []) await cancelJobSchedule(c.env, job);
      await c.env.DB.prepare("DELETE FROM jobs WHERE session_id = ? AND owner_email = ?").bind(id, email).run();
      await deleteSessionArtifacts(c.env, c.get("identity"), id);
      await c.env.DB.prepare(
        "DELETE FROM sessions WHERE id = ? AND owner_email = ?",
      )
        .bind(id, email)
        .run();
    } catch (error) {
      return c.json<ApiResponse>({
        ok: false,
        command: `DELETE /api/sessions/${id}`,
        error: { code: "DELETE_FAILED", message: error instanceof Error ? error.message : String(error) },
        next_actions: [],
      }, 500);
    }

    return c.json<ApiResponse>({
      ok: true,
      command: `DELETE /api/sessions/${id}`,
      result: { deleted: id },
      next_actions: [
        { command: "GET /api/sessions", description: "List remaining sessions" },
      ],
    });
  });

  // ─── Incremental session entries feed ─────────────────────────────────────
  // GET /api/sessions/:id/entries?after=<conversation_entries.id>&limit=<n>
  // Stable monotonic D1 ids make this safe for idempotent external polling.
  app.get("/api/sessions/:id/entries", async (c) => {
    const id = c.req.param("id");
    const email = c.get("identity").email;
    const after = parseEntriesCursor(c.req.query("after"));
    const limit = clampEntriesLimit(c.req.query("limit"));
    if (after === null) {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "BAD_CURSOR", message: "after must be a non-negative conversation entry id" }, next_actions: [] }, 400);
    }
    const owned = await c.env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ?")
      .bind(id, email).first<{ id: string }>();
    if (!owned) {
      return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "session not found or not owned" }, next_actions: [] }, 404);
    }
    const result = await c.env.DB.prepare(
      "SELECT id, ts, role, tool, is_error, content, meta_json FROM conversation_entries WHERE session_id = ? AND owner_email = ? AND id > ? ORDER BY id ASC LIMIT ?",
    ).bind(id, email, after, limit + 1).all<ConversationEntryRow>();
    const rows = result.results ?? [];
    const page = pageConversationEntries(rows, limit, after);
    return c.json<ApiResponse>({
      ok: true,
      command: c.req.path,
      result: { sessionId: id, ...page },
      next_actions: [],
    });
  });

  // ─── Session export ────────────────────────────────────────────────────────
  // GET /api/sessions/:id/export?format=markdown|json
  //
  // Owner-only export of the durable conversation history for a session, sourced
  // from the D1 `conversation_entries` table (the same canonical log that powers
  // `search_conversations`). The Sandbox JSONL mirror is intentionally NOT used
  // here — D1 is the hot path, is always available, and doesn't require spinning
  // up the user's container just to read history.
  //
  // Ownership is enforced by joining against `sessions.owner_email`. The session
  // row must exist and belong to the caller; otherwise we 404 (we don't leak the
  // difference between "doesn't exist" and "exists but not yours").
  //
  // Response is a download (Content-Disposition: attachment) so users can
  // click a link or hit the endpoint in a browser and get a file. JSON format
  // returns the structured rows; Markdown is a human-readable transcript that
  // groups assistant turns, user prompts, and tool calls in chronological order.
  app.get("/api/sessions/:id/export", async (c) => {
    const id = c.req.param("id");
    const email = c.get("identity").email;
    const fmtParam = (c.req.query("format") ?? "markdown").toLowerCase();
    const format: "markdown" | "json" =
      fmtParam === "json" ? "json" : "markdown";

    // Verify ownership + load session metadata in one query. We need name/timestamps
    // for the export header anyway, so this doubles as the auth check.
    type ExportSession = {
      id: string;
      name: string;
      status: string;
      created_at: string;
      updated_at: string;
      owner_email: string;
    };
    let session: ExportSession | null = null;
    try {
      session = await c.env.DB.prepare(
        "SELECT id, name, status, created_at, updated_at, owner_email FROM sessions WHERE id = ? AND owner_email = ?",
      )
        .bind(id, email)
        .first<ExportSession>();
    } catch (err) {
      return c.json<ApiResponse>(
        {
          ok: false,
          command: `GET /api/sessions/${id}/export`,
          error: {
            code: "DBError",
            message: err instanceof Error ? err.message : String(err),
          },
          next_actions: [],
        },
        500,
      );
    }
    if (!session) {
      return c.json<ApiResponse>(
        {
          ok: false,
          command: `GET /api/sessions/${id}/export`,
          error: { code: "NotFound", message: "session not found or not owned" },
          next_actions: [
            { command: "GET /api/sessions", description: "List sessions you own" },
          ],
        },
        404,
      );
    }

    // Pull all conversation entries for this session in chronological order.
    // `id ASC` is stable because the column is AUTOINCREMENT; `ts` alone could
    // tie if two entries land in the same second.
    let rows: Array<{
      id: number;
      session_id: string;
      ts: string;
      role: string;
      tool: string | null;
      is_error: number;
      content: string | null;
      meta_json: string | null;
    }> = [];
    try {
      const result = await c.env.DB.prepare(
        "SELECT id, session_id, ts, role, tool, is_error, content, meta_json FROM conversation_entries WHERE session_id = ? AND owner_email = ? ORDER BY id ASC",
      )
        .bind(id, email)
        .all();
      rows = (result.results as typeof rows) ?? [];
    } catch (err) {
      return c.json<ApiResponse>(
        {
          ok: false,
          command: `GET /api/sessions/${id}/export`,
          error: {
            code: "DBError",
            message: err instanceof Error ? err.message : String(err),
          },
          next_actions: [],
        },
        500,
      );
    }

    // Sanitize the session name into a filesystem-friendly slug for the
    // Content-Disposition filename. Anything outside [A-Za-z0-9_-] becomes "_"
    // and we cap length; the session id stays in the filename for uniqueness.
    const slug = (session.name || "session")
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "session";
    const shortId = id.slice(0, 8);

    if (format === "json") {
      const payload = {
        session: {
          id: session.id,
          name: session.name,
          status: session.status,
          owner: session.owner_email,
          created_at: session.created_at,
          updated_at: session.updated_at,
        },
        exported_at: new Date().toISOString(),
        entry_count: rows.length,
        entries: rows.map((r) => ({
          id: r.id,
          ts: r.ts,
          role: r.role,
          tool: r.tool,
          is_error: r.is_error === 1,
          content: r.content,
          meta: parseMetaJson(r.meta_json),
        })),
      };
      const body = JSON.stringify(payload, null, 2);
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${slug}-${shortId}.json"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // Markdown branch — render a readable transcript. Headings call out the
    // session metadata; each entry becomes a labeled block. Code fences are
    // used for tool args/results and assistant content so any embedded markdown
    // in user/assistant messages doesn't get rendered as structure.
    const md = renderMarkdownTranscript(session, rows);
    return new Response(md, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-${shortId}.md"`,
        "Cache-Control": "no-store",
      },
    });
  });

  function parseMetaJson(s: string | null): unknown {
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return s; // keep raw on parse failure rather than dropping signal
    }
  }

  function renderMarkdownTranscript(
    session: {
      id: string;
      name: string;
      status: string;
      created_at: string;
      updated_at: string;
      owner_email: string;
    },
    rows: Array<{
      ts: string;
      role: string;
      tool: string | null;
      is_error: number;
      content: string | null;
      meta_json: string | null;
    }>,
  ): string {
    const lines: string[] = [];
    lines.push(`# ${session.name || "Session"}`);
    lines.push("");
    lines.push(`- **Session ID:** \`${session.id}\``);
    lines.push(`- **Owner:** ${session.owner_email}`);
    lines.push(`- **Status:** ${session.status}`);
    lines.push(`- **Created:** ${session.created_at}`);
    lines.push(`- **Updated:** ${session.updated_at}`);
    lines.push(`- **Exported:** ${new Date().toISOString()}`);
    lines.push(`- **Entries:** ${rows.length}`);
    lines.push("");
    lines.push("---");
    lines.push("");

    if (rows.length === 0) {
      lines.push("_No conversation entries recorded for this session._");
      lines.push("");
      return lines.join("\n");
    }

    for (const r of rows) {
      const roleLabel = formatRoleLabel(r.role, r.tool, r.is_error === 1);
      lines.push(`## ${roleLabel}`);
      lines.push("");
      lines.push(`_${r.ts}_`);
      lines.push("");
      const content = r.content ?? "";
      if (r.role === "tool") {
        // Tool content is typically JSON or terminal output; fence it raw.
        lines.push("```");
        lines.push(content);
        lines.push("```");
        const args = extractToolArgs(r.meta_json);
        if (args !== null) {
          lines.push("");
          lines.push("<details><summary>Tool arguments</summary>");
          lines.push("");
          lines.push("```json");
          lines.push(args);
          lines.push("```");
          lines.push("");
          lines.push("</details>");
        }
      } else if (content.length === 0) {
        lines.push("_(empty)_");
      } else {
        // User/assistant/system/error content. Render as prose; quote-prefix to
        // visually separate from the transcript chrome without breaking embedded
        // code fences inside the message.
        for (const line of content.split("\n")) {
          lines.push(`> ${line}`);
        }
      }
      const reasoning = r.role === "assistant" ? extractReasoning(r.meta_json) : null;
      if (reasoning) {
        lines.push("");
        lines.push("<details><summary>Thinking</summary>");
        lines.push("");
        lines.push("```");
        lines.push(reasoning);
        lines.push("```");
        lines.push("");
        lines.push("</details>");
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  function formatRoleLabel(role: string, tool: string | null, isError: boolean): string {
    switch (role) {
      case "user":
        return "User";
      case "assistant":
        return "Assistant";
      case "system":
        return "System";
      case "error":
        return "Error";
      case "tool":
        return `Tool: ${tool ?? "unknown"}${isError ? " (error)" : ""}`;
      default:
        return role;
    }
  }

  function extractToolArgs(metaJson: string | null): string | null {
    if (!metaJson) return null;
    try {
      const parsed = JSON.parse(metaJson) as { args?: unknown };
      if (parsed && "args" in parsed && parsed.args !== undefined) {
        return JSON.stringify(parsed.args, null, 2);
      }
    } catch {
      /* fall through */
    }
    return null;
  }

  function extractReasoning(metaJson: string | null): string | null {
    if (!metaJson) return null;
    try {
      const parsed = JSON.parse(metaJson) as { reasoning?: unknown };
      return typeof parsed.reasoning === "string" && parsed.reasoning.trim()
        ? parsed.reasoning
        : null;
    } catch {
      return null;
    }
  }


  // ─── Inbound steering (Track A) ────────────────────────────────────────────
  // POST /api/sessions/:id/inject  { content: string, clientMsgId?: string }
  // Authenticated owner-only. Injects a user message into the native Think
  // session via its durable submission path, so any connected browser sees
  // the message + assistant response live over the same WS that
  // /agents/my-agent/:id is using. Ownership is validated against the D1
  // sessions row (same pattern as PATCH/DELETE above). The DO itself also
  // requires identity to be seeded (via POST /api/sessions) before it will
  // accept an injection.
  app.post("/api/sessions/:id/inject", async (c) => {
    const id = c.req.param("id");
    const identity = c.get("identity");
    const body = (await c.req
      .json<{ content?: string; clientMsgId?: string; attachments?: import("../types").Attachment[] }>()
      .catch(() => ({}))) as { content?: string; clientMsgId?: string; attachments?: import("../types").Attachment[] };
    const content = (body.content ?? "").trim();
    if (!content) {
      return c.json(
        {
          ok: false,
          command: `POST /api/sessions/${id}/inject`,
          error: { tag: "InvalidContent", message: "content must be non-empty" },
        },
        400,
      );
    }

    // Fail closed before resolving the session facet. A D1 failure must not
    // turn an owner-only route into a best-effort check.
    try {
      if (!(await requireOwnedSession(c.env, id, identity.email))) {
        return c.json(
          {
            ok: false,
            command: `POST /api/sessions/${id}/inject`,
            error: { tag: "NotFound", message: "session not found or not owned" },
          },
          404,
        );
      }
    } catch (err) {
      if (!(err instanceof SessionOwnershipCheckError)) throw err;
      return c.json(
        {
          ok: false,
          command: `POST /api/sessions/${id}/inject`,
          error: {
            tag: "OwnershipCheckFailed",
            message: err.message,
          },
        },
        503,
      );
    }

    try {
      const stub = await getSessionAgent(c.env, c.get("identity").email, id);
      await stub.seedIdentity(c.get("identity"));
      try {
        await stub.injectUserMessage({ content, clientMsgId: body.clientMsgId, attachments: body.attachments });
      } catch (err) {
        return c.json(
          {
            ok: false,
            command: `POST /api/sessions/${id}/inject`,
            error: {
              tag: "InjectFailed",
              message: err instanceof Error ? err.message : String(err),
            },
          },
          500,
        );
      }
    } catch (err) {
      return c.json(
        {
          ok: false,
          command: `POST /api/sessions/${id}/inject`,
          error: {
            tag: "AgentUnreachable",
            message: err instanceof Error ? err.message : String(err),
          },
        },
        500,
      );
    }

    // Touch updated_at so the sidebar reorders this session to the top,
    // matching the behavior of a real WS user message.
    try {
      await c.env.DB.prepare(
        "UPDATE sessions SET updated_at = datetime('now') WHERE id = ? AND owner_email = ?",
      )
        .bind(id, identity.email)
        .run();
    } catch {
      /* dev D1 missing — ignore */
    }

    return c.json<ApiResponse>({
      ok: true,
      command: `POST /api/sessions/${id}/inject`,
      result: { sessionId: id, injected: true },
      next_actions: [
        {
          command: `ws://host/agents/my-agent/${id}`,
          description: "Connect the WS to observe the injected turn live",
        },
      ],
    });
  });

  // ─── Bridge ticket mint ────────────────────────────────────────────────────
  app.post("/api/sessions/:id/ticket", async (c) => {
    const sessionId = c.req.param("id");
    const identity = c.get("identity");
    const { connectorId } = (await c.req
      .json<{ connectorId: ConnectorId }>()
      .catch(() => ({ connectorId: "" as ConnectorId }))) as {
      connectorId: ConnectorId;
    };
    if (!connectorId) {
      return c.json<ApiResponse>({
        ok: false,
        command: c.req.path,
        error: { code: "BAD_REQUEST", message: "connectorId required in JSON body" },
        next_actions: [],
      }, 400);
    }

    const owned = await c.env.DB.prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ?").bind(sessionId, identity.email.toLowerCase()).first<{ id: string }>();
    if (!owned) return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "session not found or not owned" }, next_actions: [] }, 404);
    const store = makeOAuthClientStore(c.env.OAUTH_CLIENT, new URL(c.req.url).origin);
    const userMcps = await store.listUserMcps(identity.email);
    try { getConnector(c.env, connectorId, userMcps); }
    catch { return c.json<ApiResponse>({ ok: false, command: c.req.path, error: { code: "NOT_FOUND", message: "connector not found or not owned" }, next_actions: [] }, 404); }

    const ticket = await mintBridgeTicket(c.env, {
      identity,
      sessionId,
      connectorId,
    });

    return c.json<ApiResponse>({
      ok: true,
      command: "POST /api/sessions/:id/ticket",
      result: { ticket, ttlSeconds: 300, connectorId },
      next_actions: [
        {
          command: `POST /bridge/${connectorId}/<upstream-path>`,
          description: "Use the ticket as Authorization: Bearer <ticket>",
        },
      ],
    });
  });

}
