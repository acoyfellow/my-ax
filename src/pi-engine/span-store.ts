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
export const SPAN_INGEST_MAX = 500;
export const SPAN_SOURCES = ["pi-local"] as const;
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

const HEX = /^[0-9a-f]{8,64}$/;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SPAN_NAMES = new Set(["pi.durable.submit", "pi.durable.phase", "pi.ai.request"]);

function bounded(value: unknown, max: number): string | null {
  return typeof value === "string" && value ? value.slice(0, max) : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function ingestRow(input: unknown, ownerEmail: string, source: string): SpanRow | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const spanId = typeof row.span_id === "string" && HEX.test(row.span_id) ? row.span_id : null;
  const traceId = typeof row.trace_id === "string" && HEX.test(row.trace_id) ? row.trace_id : null;
  const chatId = typeof row.chat_id === "string" && SAFE_ID.test(row.chat_id) ? row.chat_id : null;
  const name = typeof row.name === "string" && SPAN_NAMES.has(row.name) ? row.name : null;
  const status = row.status === "ok" || row.status === "error" ? row.status : null;
  const startedMs = finite(row.started_ms);
  const durMs = finite(row.dur_ms);
  if (!spanId || !traceId || !chatId || !name || !status || startedMs === null || durMs === null) return null;
  return {
    span_id: `${source}:${spanId}`,
    trace_id: traceId,
    parent_id: typeof row.parent_id === "string" && HEX.test(row.parent_id) ? `${source}:${row.parent_id}` : null,
    owner_email: ownerEmail.toLowerCase(),
    chat_id: `${source}:${chatId}`,
    source,
    name,
    phase: bounded(row.phase, 32),
    task_name: bounded(row.task_name, 64),
    tool_name: bounded(row.tool_name, 128),
    model: bounded(row.model, 128),
    status,
    error: bounded(row.error, 300),
    started_ms: Math.round(startedMs),
    dur_ms: Math.round(durMs),
    input_tokens: finite(row.input_tokens),
    output_tokens: finite(row.output_tokens),
    cache_read_tokens: finite(row.cache_read_tokens),
    cache_write_tokens: finite(row.cache_write_tokens),
    cost_usd: finite(row.cost_usd),
  };
}

export async function ingestSpans(db: D1Database, ownerEmail: string, source: string, inputs: unknown[]): Promise<{ stored: number; rejected: number }> {
  const rows = inputs.slice(0, SPAN_INGEST_MAX).map((input) => ingestRow(input, ownerEmail, source)).filter((row): row is SpanRow => row !== null);
  if (rows.length) await db.batch(rows.map((row) => db.prepare(INSERT_SQL).bind(...COLUMNS.map((column) => row[column]))));
  return { stored: rows.length, rejected: Math.min(inputs.length, SPAN_INGEST_MAX) - rows.length };
}
