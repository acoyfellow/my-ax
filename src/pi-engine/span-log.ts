import type { SpanAttributes, SpanLink, SpanOptions, SpanStatus, TelemetryContext, TelemetrySpan } from "@earendil-works/pi-telemetry";

export type SpanRecord = {
  ev: "pi.span";
  name: string;
  traceId: string;
  spanId: string;
  parentId?: string;
  chat: string;
  startedMs: number;
  durMs: number;
  status: "ok" | "error";
  error?: string;
  events?: string[];
  attrs: SpanAttributes;
};

export type SpanSink = (record: SpanRecord) => void;

const MAX_EVENTS = 20;
const MAX_ERROR_CHARS = 300;

function randomHex(bytes: number): string {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

class LoggedSpan implements TelemetrySpan {
  private readonly attrs: SpanAttributes;
  private readonly events: string[] = [];
  private status: SpanStatus = { status: "ok" };
  private explicitStatus = false;
  private settled = false;
  readonly spanId = randomHex(8);

  constructor(
    private readonly root: SpanLogContext,
    private readonly options: SpanOptions,
    readonly traceId: string,
    private readonly parentId: string | undefined,
    private readonly startedMs: number,
  ) {
    this.attrs = { ...options.attributes };
  }

  startSpan<T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> {
    return this.root.run(options, callback, this.traceId, this.spanId);
  }

  addLink(_link: SpanLink): void {}

  addEvent(name: string, attributes?: SpanAttributes): void {
    if (this.settled || this.events.length >= MAX_EVENTS) return;
    const type = attributes?.type ?? attributes?.kind;
    this.events.push(type === undefined ? name : `${name}:${String(type)}`);
  }

  setAttributes(attributes: SpanAttributes): void {
    if (this.settled) return;
    for (const [key, value] of Object.entries(attributes)) if (value !== undefined) this.attrs[key] = value;
  }

  setStatus(status: SpanStatus): void {
    if (this.settled) return;
    this.status = status;
    this.explicitStatus = true;
  }

  finish(failure: unknown, failed: boolean): void {
    if (this.settled) return;
    this.settled = true;
    const status = this.explicitStatus ? this.status : failed ? { status: "error" as const, error: { name: "Error", message: failure instanceof Error ? failure.message : String(failure) } } : this.status;
    const record: SpanRecord = {
      ev: "pi.span",
      name: this.options.name,
      traceId: this.traceId,
      spanId: this.spanId,
      chat: this.root.chat,
      startedMs: this.startedMs,
      durMs: Math.max(0, this.root.now() - this.startedMs),
      status: status.status,
      attrs: this.attrs,
    };
    if (this.parentId) record.parentId = this.parentId;
    if (status.status === "error" && status.error) record.error = status.error.message.slice(0, MAX_ERROR_CHARS);
    if (this.events.length) record.events = this.events;
    this.root.emit(record);
  }
}

export class SpanLogContext implements TelemetryContext {
  constructor(
    private readonly chatLabel: () => string,
    private readonly sink: SpanSink,
    readonly now: () => number = Date.now,
  ) {}

  get chat(): string {
    try {
      return this.chatLabel();
    } catch {
      return "unbound";
    }
  }

  startSpan<T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>): Promise<T> {
    return this.run(options, callback, randomHex(16), undefined);
  }

  run<T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>, traceId: string, parentId: string | undefined): Promise<T> {
    const span = new LoggedSpan(this, options, traceId, parentId, this.now());
    let result: T | Promise<T>;
    try {
      result = callback(span);
    } catch (error) {
      span.finish(error, true);
      return Promise.reject(error);
    }
    return Promise.resolve(result).then(
      (value) => { span.finish(undefined, false); return value; },
      (error: unknown) => { span.finish(error, true); throw error; },
    );
  }

  emit(record: SpanRecord): void {
    try {
      this.sink(record);
    } catch {}
  }
}

export function consoleSpanSink(record: SpanRecord): void {
  console.log(JSON.stringify(record));
}
