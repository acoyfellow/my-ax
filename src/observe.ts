export type ObserveEntryRow = { id: number; ts: string; role: string; tool: string | null; is_error: number; content: string | null; meta_json: string | null };
export type ObserveStepRow = { ts: string; cycle_index: number; model: string | null; finish_reason: string | null; input_tokens: number | null; output_tokens: number | null };

export type ObservedToolCall = { at: string; tool: string; durationMs: number | null; ok: boolean; error: string | null };
export type ObservedTurn = {
  startedAt: string;
  prompt: string;
  endedAt: string | null;
  status: string;
  model: string | null;
  tools: ObservedToolCall[];
  steps: Array<{ at: string; finishReason: string | null; inputTokens: number | null; outputTokens: number | null }>;
};

function parseMeta(raw: string | null): Record<string, unknown> {
  try { return raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { return {}; }
}

function toolError(row: ObserveEntryRow): string | null {
  const text = row.content ?? "";
  try {
    const parsed = JSON.parse(text) as { ok?: unknown; error?: unknown; result?: { error?: unknown; exitCode?: unknown } };
    const error = parsed.result?.error ?? parsed.error;
    if (typeof error === "string" && error) return error.slice(0, 300);
    if (parsed.ok === false) return text.slice(0, 300);
  } catch {}
  return row.is_error ? text.slice(0, 300) : null;
}

export function buildObservedTurns(entries: readonly ObserveEntryRow[], steps: readonly ObserveStepRow[]): ObservedTurn[] {
  const turns: ObservedTurn[] = [];
  let current: ObservedTurn | null = null;
  for (const row of [...entries].sort((a, b) => a.id - b.id)) {
    if (row.role === "user") {
      current = { startedAt: row.ts, prompt: (row.content ?? "").slice(0, 200), endedAt: null, status: "running", model: null, tools: [], steps: [] };
      turns.push(current);
      continue;
    }
    if (!current) continue;
    const meta = parseMeta(row.meta_json);
    if (row.role === "tool") {
      const error = toolError(row);
      current.tools.push({ at: row.ts, tool: row.tool ?? "tool", durationMs: typeof meta.durationMs === "number" ? meta.durationMs : null, ok: !error, error });
    } else if (row.role === "assistant" || row.role === "error") {
      current.endedAt = row.ts;
      current.status = typeof meta.status === "string" ? meta.status : row.role === "error" ? "error" : "completed";
      current.model = typeof meta.model === "string" ? meta.model : current.model;
    }
  }
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index];
    const until = turns[index + 1]?.startedAt ?? "\uffff";
    for (const step of steps) {
      if (step.ts >= turn.startedAt && step.ts < until) turn.steps.push({ at: step.ts, finishReason: step.finish_reason, inputTokens: step.input_tokens, outputTokens: step.output_tokens });
    }
  }
  return turns;
}

type D1Like = { prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results?: T[] }> } } };

export async function observeSessionTurns(db: D1Like, ownerEmail: string, sessionId: string, lastTurns = 3): Promise<ObservedTurn[]> {
  const entries = await db.prepare(
    "SELECT id, ts, role, tool, is_error, substr(content, 1, 2000) AS content, meta_json FROM conversation_entries WHERE session_id = ? AND owner_email = ? AND id >= COALESCE((SELECT id FROM conversation_entries WHERE session_id = ? AND owner_email = ? AND role = 'user' ORDER BY id DESC LIMIT 1 OFFSET ?), 0) ORDER BY id ASC LIMIT 500",
  ).bind(sessionId, ownerEmail, sessionId, ownerEmail, Math.max(0, Math.min(lastTurns, 20) - 1)).all<ObserveEntryRow>();
  const rows = entries.results ?? [];
  const since = rows[0]?.ts ?? "";
  const steps = await db.prepare(
    "SELECT ts, cycle_index, model, finish_reason, input_tokens, output_tokens FROM cycle_costs WHERE session_or_run_id = ? AND owner_email = ? AND ts >= ? ORDER BY ts ASC LIMIT 500",
  ).bind(sessionId, ownerEmail, since).all<ObserveStepRow>();
  return buildObservedTurns(rows, steps.results ?? []);
}

export async function observeWorkspace(db: D1Like, workspaceKey: string): Promise<{ snapshots: Array<{ at: string; name: string; sizeBytes: number | null }> }> {
  const rows = await db.prepare("SELECT created_at, name, size_bytes FROM workspace_snapshot_history WHERE workspace_key = ? ORDER BY id DESC LIMIT 10").bind(workspaceKey).all<{ created_at: string; name: string; size_bytes: number | null }>();
  return { snapshots: (rows.results ?? []).map((row) => ({ at: row.created_at, name: row.name, sizeBytes: row.size_bytes })) };
}
