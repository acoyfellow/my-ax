// conversation-log.ts — conversation turns are indexed in D1 for fast,
// cross-session memory search and mirrored to workspace JSONL when available.
//
// D1 FTS is the product hot path (`search_conversations`). JSONL remains a
// useful human-readable workspace artifact for export/debugging, and is kept
// best-effort so memory does not depend on workspace I/O.
//
// Failure mode: if the Sandbox container is unreachable mid-turn, the
// log append fails. We log the error to console + AUDIT_KV and keep
// going — the turn still completes, the in-DO state is still authoritative
// for the active session. Worst case: a turn is missing from the persistent
// log; the live session continues unaffected.

import type { Env } from "./types";
import type { AccessIdentity } from "./auth";
import { getUserWorkspace } from "./workspace";

const LOG_DIR = "/home/user/.my-ax/conversations";

export interface ConversationLogEntry {
  /** ISO 8601 timestamp. */
  ts: string;
  /** Role of the entry. "tool" lines record both call + result for symmetry. */
  role: "user" | "assistant" | "tool" | "system" | "error";
  /** For role=tool: the tool name. Otherwise undefined. */
  tool?: string;
  /** For role=tool: was this an error? */
  isError?: boolean;
  /** Free-form content. For tool results, JSON-stringified for grep-ability. */
  content?: string;
  /** Any extra metadata we want to keep — model, status, etc. */
  meta?: Record<string, unknown>;
}

/** Append a single entry to the user's conversation log for this session.
 *  Idempotent-friendly: callers don't need to dedupe; the log is append-only.
 *  Errors are swallowed (logged to console) so the agent loop never crashes
 *  on log failures — the in-DO session state is still authoritative. */
export async function appendConversationLog(
  env: Env,
  identity: AccessIdentity,
  sessionId: string,
  entry: ConversationLogEntry,
): Promise<void> {
  const path = `${LOG_DIR}/${sessionId}.jsonl`;
  const line = JSON.stringify(entry) + "\n";
  let inserted = false;

  try {
    const metaJson = entry.meta ? JSON.stringify(entry.meta).slice(0, 4096) : null;
    const uiMessageId = typeof entry.meta?.uiMessageId === "string" ? entry.meta.uiMessageId : null;
    const toolCallId = typeof entry.meta?.toolCallId === "string" ? entry.meta.toolCallId : null;
    if (uiMessageId) {
      const write = await env.DB.prepare(
        `INSERT INTO conversation_entries(session_id, owner_email, ts, role, tool, is_error, content, meta_json)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM conversation_entries
           WHERE session_id = ? AND owner_email = ? AND role = ?
             AND json_extract(meta_json, '$.uiMessageId') = ?
         )`,
      ).bind(
        sessionId, identity.email.toLowerCase(), entry.ts, entry.role, entry.tool ?? null, entry.isError ? 1 : 0, entry.content ?? null, metaJson,
        sessionId, identity.email.toLowerCase(), entry.role, uiMessageId,
      ).run();
      inserted = (write.meta?.changes ?? 0) > 0;
    } else if (toolCallId) {
      const write = await env.DB.prepare(
        `INSERT INTO conversation_entries(session_id, owner_email, ts, role, tool, is_error, content, meta_json)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM conversation_entries
           WHERE session_id = ? AND owner_email = ? AND role = 'tool'
             AND json_extract(meta_json, '$.toolCallId') = ?
         )`,
      ).bind(
        sessionId, identity.email.toLowerCase(), entry.ts, entry.role, entry.tool ?? null, entry.isError ? 1 : 0, entry.content ?? null, metaJson,
        sessionId, identity.email.toLowerCase(), toolCallId,
      ).run();
      inserted = (write.meta?.changes ?? 0) > 0;
    } else {
      const write = await env.DB.prepare(
        `INSERT INTO conversation_entries(session_id, owner_email, ts, role, tool, is_error, content, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        sessionId,
        identity.email.toLowerCase(),
        entry.ts,
        entry.role,
        entry.tool ?? null,
        entry.isError ? 1 : 0,
        entry.content ?? null,
        metaJson,
      ).run();
      inserted = (write.meta?.changes ?? 0) > 0;
    }
  } catch (err) {
    console.error("conversation_memory_append_failed", {
      sessionId,
      role: entry.role,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  if (!inserted) return;

  try {
    const { sandbox } = await getUserWorkspace(env, identity);

    // Atomic append in the container avoids read-modify-write races. The
    // JSON line is base64-decoded in the shell so user/model content never
    // participates in command quoting.
    const encoded = bytesToBase64(new TextEncoder().encode(line));
    const result = await sandbox.exec(
      `mkdir -p ${LOG_DIR} && printf %s '${encoded}' | base64 -d >> ${path}`,
      { timeout: 10_000, origin: "internal" },
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || `conversation append exited ${result.exitCode}`);
    }
  } catch (err) {
    // Don't bubble up — logging is best-effort. The active session still
    // has the data in DO state.
    console.error("conversation_log_append_failed", {
      sessionId,
      role: entry.role,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Convenience: log a user message. */
export function logUserMessage(
  env: Env,
  identity: AccessIdentity,
  sessionId: string,
  content: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  return appendConversationLog(env, identity, sessionId, {
    ts: new Date().toISOString(),
    role: "user",
    content,
    ...(meta ? { meta } : {}),
  });
}

/** Convenience: log an assistant message. */
export function logAssistantMessage(
  env: Env,
  identity: AccessIdentity,
  sessionId: string,
  content: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  return appendConversationLog(env, identity, sessionId, {
    ts: new Date().toISOString(),
    role: "assistant",
    content,
    ...(meta ? { meta } : {}),
  });
}

/** Convenience: log a tool call + result as one entry. */
export function logToolCall(
  env: Env,
  identity: AccessIdentity,
  sessionId: string,
  toolName: string,
  args: unknown,
  result: { content: string; isError: boolean },
  meta?: Record<string, unknown>,
): Promise<void> {
  return appendConversationLog(env, identity, sessionId, {
    ts: new Date().toISOString(),
    role: "tool",
    tool: toolName,
    isError: result.isError,
    content: result.content,
    meta: { args, ...(meta ?? {}) },
  });
}
