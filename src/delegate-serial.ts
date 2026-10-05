import { z } from "zod";
import type { AgentToolFailure } from "agents/agent-tools";
import { isTransientRateLimit } from "./upstream-rate-limit";

export const DELEGATE_MANY_LIMIT = 1000;
export const DELEGATE_INITIAL_CONCURRENCY = 32;
export const DELEGATE_MIN_CONCURRENCY = 1;
export const DELEGATE_RATE_LIMIT_RETRIES = 4;

const OPENAI_STORED_ITEM_ID = /^rs_[A-Za-z0-9]+$/;

export function isOpenAiStoredItemId(value: unknown): value is string {
  return typeof value === "string" && OPENAI_STORED_ITEM_ID.test(value);
}

export function collectOpenAiStoredItemIds(value: unknown, found = new Set<string>()): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) collectOpenAiStoredItemIds(entry, found);
    return [...found];
  }
  if (!value || typeof value !== "object") return [...found];
  const record = value as Record<string, unknown>;
  if (isOpenAiStoredItemId(record.itemId)) found.add(record.itemId);
  if (isOpenAiStoredItemId(record.previousResponseId)) found.add(record.previousResponseId);
  if (record.type === "item_reference" && isOpenAiStoredItemId(record.id)) found.add(record.id);
  for (const nested of Object.values(record)) collectOpenAiStoredItemIds(nested, found);
  return [...found];
}

export function stripOpenAiStoredItemRefs<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => stripOpenAiStoredItemRefs(entry)) as T;
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) {
    if ((key === "itemId" || key === "previousResponseId") && isOpenAiStoredItemId(nested)) continue;
    if (key === "id" && record.type === "item_reference" && isOpenAiStoredItemId(nested)) continue;
    next[key] = stripOpenAiStoredItemRefs(nested);
  }
  return next as T;
}

export const delegateResultSchema = z.object({
  runId: z.string(),
  taskFingerprint: z.string(),
  label: z.string().max(80).optional(),
  // "deferred" = never launched because an earlier task hit the shared
  // inference rate limit (3021). Truthful backpressure, not a failure.
  status: z.enum(["completed", "error", "aborted", "interrupted", "deferred"]),
  summary: z.string().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  attempts: z.number().int().min(0).max(2 + DELEGATE_RATE_LIMIT_RETRIES),
});
export type DelegateResult = z.infer<typeof delegateResultSchema>;

/** Stable, non-secret FNV-1a fingerprint. An idempotency key, not authentication. */
export function taskFingerprint(task: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(task.trim().replace(/\s+/g, " "))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function delegateRunId(parentName: string, delegationId: string, task: string, index: number): string {
  // Stable across replay but distinct for a later delegation of the same text.
  return `delegate:${taskFingerprint(parentName)}:${taskFingerprint(delegationId)}:${index}:${taskFingerprint(task)}`;
}

/** Placeholder id for a never-launched (deferred) task. Distinct prefix so it
 *  can never collide with a real delegate run id or be reused as evidence. */
export function delegateDeferredRunId(index: number): string {
  return `delegate:deferred:${index}`;
}

export function shouldRetryDelegate(failure: AgentToolFailure, attempts: number): boolean {
  // Only retry when the child is CONFIRMED stopped. Unknown liveness
  // (childStillRunning undefined) must not retry — a still-running child would
  // be duplicated.
  return failure.status === "interrupted" && failure.retryable && failure.childStillRunning === false && attempts < 2;
}

/** A failure whose error text is a transient upstream rate limit (3021 / 429 /
 *  overloaded). These surface as status "error" (a thrown SDK error carrying
 *  the gateway message), NOT as an interruption. */
export function isRateLimitFailure(failure: AgentToolFailure | undefined): boolean {
  if (!failure) return false;
  return isTransientRateLimit(failure.error);
}

/** Whether to retry THIS delegate in-call. A 3021 is shared backpressure and is
 *  NEVER retried in-call; only a stopped, non-running interruption is. */
export function shouldRetryDelegateAttempt(failure: AgentToolFailure | undefined, attempts: number): boolean {
  if (!failure) return false;
  if (isRateLimitFailure(failure)) return false;
  return shouldRetryDelegate(failure, attempts);
}

/** One delegate launch outcome. Pure boundary so the orchestrator is testable
 *  without the Think import chain. */
export type DelegateTaskOutcome = {
  runId: string;
  status: "completed" | "error" | "aborted" | "interrupted";
  summary?: string;
  output?: unknown;
  error?: string;
  failure?: AgentToolFailure;
};

export type ParallelDelegateOptions = {
  initialConcurrency?: number;
  rateLimitRetries?: number;
  backoff?: (attempt: number) => Promise<void>;
  deadline?: () => boolean;
};

type AdmissionState = { limit: number; active: number; waiters: Array<() => void> };

function admit(state: AdmissionState): Promise<void> {
  if (state.active < state.limit) { state.active++; return Promise.resolve(); }
  return new Promise((resolve) => state.waiters.push(() => { state.active++; resolve(); }));
}

function release(state: AdmissionState): void {
  state.active--;
  while (state.active < state.limit && state.waiters.length) state.waiters.shift()!();
}

function narrow(state: AdmissionState): void {
  state.limit = Math.max(DELEGATE_MIN_CONCURRENCY, Math.floor(state.limit / 2));
}

function widen(state: AdmissionState, ceiling: number): void {
  if (state.limit < ceiling) state.limit++;
  while (state.active < state.limit && state.waiters.length) state.waiters.shift()!();
}

function isRateLimitedOutcome(out: DelegateTaskOutcome): boolean {
  return isRateLimitFailure(out.failure) || isTransientRateLimit(out.error);
}

const defaultBackoff = (attempt: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.min(8_000, 500 * 2 ** attempt) * (0.5 + Math.random())));

function deferredResult(task: { label?: string; task: string }, index: number, attempts: number): DelegateResult {
  return {
    runId: delegateDeferredRunId(index),
    taskFingerprint: taskFingerprint(task.task),
    status: "deferred",
    error: "Deferred: the shared inference rate limit (3021) did not recover before the delegation deadline. Re-run this task.",
    attempts,
    label: task.label,
  };
}

export async function runDelegatesInParallel(
  tasks: { label?: string; task: string }[],
  runTask: (index: number) => Promise<DelegateTaskOutcome>,
  options: ParallelDelegateOptions = {},
): Promise<DelegateResult[]> {
  const ceiling = Math.max(DELEGATE_MIN_CONCURRENCY, Math.min(options.initialConcurrency ?? DELEGATE_INITIAL_CONCURRENCY, tasks.length));
  const rateLimitRetries = options.rateLimitRetries ?? DELEGATE_RATE_LIMIT_RETRIES;
  const backoff = options.backoff ?? defaultBackoff;
  const pastDeadline = options.deadline ?? (() => false);
  const state: AdmissionState = { limit: ceiling, active: 0, waiters: [] };

  const runOne = async (index: number): Promise<DelegateResult> => {
    let attempts = 0;
    let rateLimited = 0;
    for (;;) {
      if (pastDeadline()) return deferredResult(tasks[index], index, attempts);
      await admit(state);
      let out: DelegateTaskOutcome;
      try {
        attempts++;
        out = await runTask(index);
      } finally {
        release(state);
      }
      if (isRateLimitedOutcome(out)) {
        narrow(state);
        if (rateLimited >= rateLimitRetries) return deferredResult(tasks[index], index, attempts);
        await backoff(rateLimited++);
        continue;
      }
      if (shouldRetryDelegateAttempt(out.failure, attempts)) continue;
      widen(state, ceiling);
      return {
        runId: out.runId,
        taskFingerprint: taskFingerprint(tasks[index].task),
        status: out.status,
        summary: out.summary,
        output: out.output,
        error: out.error,
        attempts,
        label: tasks[index].label,
      };
    }
  };

  return Promise.all(tasks.map((_, index) => runOne(index)));
}
