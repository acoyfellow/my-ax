import type { SpanRecord } from "./span-log";

export type SpanRow = {
  span_id: string;
  trace_id: string;
  parent_id: string | null;
  owner_email: string;
  chat_id: string;
  source: string;
  name: string;
  phase: string | null;
  task_name: string | null;
  tool_name: string | null;
  model: string | null;
  status: string;
  error: string | null;
  started_ms: number;
  dur_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_usd: number | null;
};

const COLUMNS = ["span_id", "trace_id", "parent_id", "owner_email", "chat_id", "source", "name", "phase", "task_name", "tool_name", "model", "status", "error", "started_ms", "dur_ms", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd"] as const;
const INSERT_SQL = `INSERT OR IGNORE INTO pi_spans (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`;
export const SPAN_RETENTION_MS = 90 * 24 * 3_600_000;
const MAX_BUFFERED = 200;

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function spanRow(record: SpanRecord, ownerEmail: string, source = "my-ax"): SpanRow {
  const attrs = record.attrs;
  return {
    span_id: record.spanId,
    trace_id: record.traceId,
    parent_id: record.parentId ?? null,
    owner_email: ownerEmail.toLowerCase(),
    chat_id: record.chat,
    source,
    name: record.name,
    phase: text(attrs.phase),
    task_name: text(attrs["task.name"]),
    tool_name: text(attrs["tool.name"]),
    model: text(attrs.model),
    status: record.status,
    error: record.error ?? null,
    started_ms: Math.round(record.startedMs),
    dur_ms: Math.round(record.durMs),
    input_tokens: count(attrs["usage.input"]),
    output_tokens: count(attrs["usage.output"]),
    cache_read_tokens: count(attrs["usage.cache_read"]),
    cache_write_tokens: count(attrs["usage.cache_write"]),
    cost_usd: count(attrs["cost.total"]),
  };
}

export class SpanBuffer {
  private rows: SpanRow[] = [];

  constructor(
    private readonly db: D1Database,
    private readonly owner: () => string | undefined,
    private readonly schedule: (flush: Promise<void>) => void,
  ) {}

  add(record: SpanRecord): void {
    const owner = this.owner();
    if (!owner || record.chat === "unbound") return;
    if (this.rows.length >= MAX_BUFFERED) this.rows.shift();
    this.rows.push(spanRow(record, owner));
    if (record.name === "pi.durable.submit" || (record.name === "pi.durable.phase" && record.attrs["task.name"] === "pi.generation" && record.attrs.outcome === "done")) this.schedule(this.flush());
  }

  pending(): number {
    return this.rows.length;
  }

  async flush(): Promise<void> {
    const rows = this.rows;
    if (!rows.length) return;
    this.rows = [];
    try {
      await this.db.batch(rows.map((row) => this.db.prepare(INSERT_SQL).bind(...COLUMNS.map((column) => row[column]))));
    } catch (error) {
      console.log(JSON.stringify({ ev: "pi.span_store_failed", rows: rows.length, error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) }));
    }
  }
}

export async function pruneSpans(db: D1Database, now = Date.now()): Promise<void> {
  await db.prepare("DELETE FROM pi_spans WHERE started_ms < ?").bind(now - SPAN_RETENTION_MS).run();
}
