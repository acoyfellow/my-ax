type Json = Record<string, unknown>;

export type WatchedView = {
  readonly entries: readonly Json[];
  readonly docs: Readonly<Record<string, Json>>;
};

export type ViewEvent = Json & { type: string };

type LiveDoc = {
  run?: unknown;
  generation?: { message?: Json; retry?: { at: number; error: string } };
  tools?: ReadonlyArray<{ callId: string; output?: string }>;
  compactions?: ReadonlyArray<{ taskId?: unknown; reason?: string; blocking?: boolean }>;
  compactionFailure?: { taskId?: unknown; reason?: string; error?: string };
  runFailure?: { taskId?: unknown; reason?: string; detail?: string };
};

export function liveDoc(view: WatchedView | null): LiveDoc {
  return (view?.docs["pi.live"] ?? {}) as LiveDoc;
}

export function isCompacting(view: WatchedView | null): boolean {
  return (liveDoc(view).compactions?.length ?? 0) > 0;
}

export function inboxLength(view: WatchedView | null): number {
  const items = (view?.docs["pi.inbox"] as { items?: unknown[] } | undefined)?.items;
  return Array.isArray(items) ? items.length : 0;
}

export function agentModel(view: WatchedView | null): string {
  const model = (view?.docs["pi.agent"] as { model?: { modelId?: string; id?: string } } | undefined)?.model;
  return model?.modelId ?? model?.id ?? "";
}

function entryId(entry: Json): number | undefined {
  return typeof entry.id === "number" ? entry.id : undefined;
}

const FAILURES_SHOWN_AS_ERRORS = new Set(["model_error", "no_model", "faulted", "orphaned", "interrupted", "restart_limit", "turn_limit"]);

export function runFailureText(failure: LiveDoc["runFailure"]): string | null {
  if (!failure?.reason || !FAILURES_SHOWN_AS_ERRORS.has(failure.reason)) return null;
  if (failure.reason === "turn_limit") return `Stopped after ${failure.detail ?? "too many tool rounds"}.`;
  return failure.detail?.trim() || failure.reason.replaceAll("_", " ");
}

type ViewOp = readonly unknown[];

const MESSAGE_CONTENT_PATH = ["docs", "pi.live", "generation", "message", "content"];

function isPath(path: unknown, prefix: readonly unknown[]): path is unknown[] {
  return Array.isArray(path) && path.length >= prefix.length && prefix.every((part, index) => path[index] === part);
}

function streamDeltas(ops: readonly ViewOp[] | undefined, next: WatchedView): Json[] | null {
  if (!ops?.length) return null;
  const changes: Json[] = [];
  for (const op of ops) {
    if (!isPath(op[1], ["docs", "pi.live", "generation", "message"])) continue;
    const path = op[1];
    const field = path[MESSAGE_CONTENT_PATH.length + 1];
    const appended = op[0] === "a" && path.length === MESSAGE_CONTENT_PATH.length + 2 && isPath(path, MESSAGE_CONTENT_PATH) && typeof op[2] === "string";
    if (!appended || (field !== "text" && field !== "thinking")) return null;
    changes.push({ type: field === "text" ? "text_delta" : "thinking_delta", contentIndex: path[MESSAGE_CONTENT_PATH.length], delta: op[2] });
  }
  return changes.length && liveDoc(next).generation?.message ? changes : null;
}

export function viewEvents(previous: WatchedView | null, next: WatchedView, ops?: readonly ViewOp[]): ViewEvent[] {
  const events: ViewEvent[] = [];
  const before = liveDoc(previous);
  const after = liveDoc(next);
  if (!before.run && after.run) events.push({ type: "run_start" });

  const wasCompacting = (before.compactions?.length ?? 0) > 0;
  const nowCompacting = (after.compactions?.length ?? 0) > 0;
  if (!wasCompacting && nowCompacting) events.push({ type: "compaction_start" });

  let compactionAppended = false;
  let assistantAppended = false;
  const known = new Set((previous?.entries ?? []).map(entryId));
  for (const entry of next.entries) {
    if (known.has(entryId(entry))) continue;
    events.push({ type: "entry_appended", entry });
    if (entry.kind === "pi.compaction") {
      compactionAppended = true;
      events.push({ type: "compaction_end" });
    }
    if (Array.isArray(entry.model) && (entry.model as Array<{ role?: unknown }>).some((message) => message.role === "assistant")) {
      assistantAppended = true;
    }
  }
  if (wasCompacting && !nowCompacting && !compactionAppended) {
    const error = after.compactionFailure && after.compactionFailure !== before.compactionFailure ? after.compactionFailure.error || "failed" : "aborted";
    events.push({ type: "compaction_end", error });
  }

  const partial = after.generation?.message;
  if (partial && partial !== before.generation?.message) {
    const deltas = before.generation?.message ? streamDeltas(ops, next) : null;
    events.push({ type: "message_update", changes: deltas ?? [{ type: "message", message: partial }] });
  } else if (before.generation?.message && !partial && !assistantAppended) {
    events.push({ type: "partial_cleared" });
  }

  const outputs = new Map((before.tools ?? []).map((tool) => [tool.callId, tool.output]));
  for (const tool of after.tools ?? []) {
    if (tool.output !== undefined && tool.output !== outputs.get(tool.callId)) events.push({ type: "tool_execution_update", toolCallId: tool.callId, output: { set: tool.output } });
  }

  if (previous && inboxLength(previous) !== inboxLength(next)) events.push({ type: "inbox_update", items: new Array(inboxLength(next)).fill(null) });
  const model = agentModel(next);
  if (previous && model && model !== agentModel(previous)) events.push({ type: "agent_changed", agent: { model: { modelId: model } } });

  if (after.runFailure && after.runFailure !== before.runFailure) {
    const text = runFailureText(after.runFailure);
    if (text) events.push({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: text } });
  }
  if (before.run && !after.run) events.push({ type: "run_end" });
  return events;
}
