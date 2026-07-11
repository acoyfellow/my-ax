// Pure serial orchestration + retry/backpressure policy for delegate-many.
//
// Kept in its OWN module (no @cloudflare/think import) so it is unit-testable
// under plain tsx without pulling the `cloudflare:` runtime scheme. delegate-
// many.ts composes this with the real Think parent.
//
// Root cause this addresses (grounded in captured production metadata): the
// delegate default model @cf/moonshotai/kimi-k2.7-code is route "workers-ai",
// used via createWorkersAI({ binding }) which exposes NO custom fetch, so the
// existing createRetryFetch wrapper cannot see its 3021s; and delegate-many
// fired up to 2 children CONCURRENTLY (Promise.all). Two children hit the
// shared per-minute inference cap at once and both failed with
// "3021: rate limiting: inference request per min rate reached" (surfaced as a
// thrown SDK error => status "error", NOT an HTTP 429 / interruption).
//
// Policy (per owner): 3021 is SHARED BACKPRESSURE.
//   - Run tasks SERIALLY, never concurrently.
//   - On 3021: do NOT retry in-call (an immediate retry against a per-minute
//     cap only amplifies pressure) and do NOT launch the remaining tasks; mark
//     them truthfully "deferred" for a later owner/turn to re-run after the cap
//     recovers.
//   - A stopped, non-running interruption keeps its single existing retry.

import { z } from "zod";
import type { AgentToolFailure } from "agents/agent-tools";
import { isTransientRateLimit } from "./upstream-rate-limit";

export const DELEGATE_MANY_LIMIT = 2;

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
  attempts: z.number().int().min(0).max(2),
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
  return failure.status === "interrupted" && failure.retryable && !failure.childStillRunning && attempts < 2;
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

/**
 * Run delegate tasks ONE AT A TIME (never concurrently). On a 3021, retain the
 * truthful failed result, stop launching the rest, and return them as
 * "deferred". `runTask(index)` performs one launch+attempt; injected so tests
 * need no real inference. No timers, no response-body inspection.
 */
export async function runDelegatesSerially(
  tasks: { label?: string; task: string }[],
  runTask: (index: number) => Promise<DelegateTaskOutcome>,
): Promise<DelegateResult[]> {
  const results: DelegateResult[] = [];
  let deferring = false;
  for (let index = 0; index < tasks.length; index++) {
    if (deferring) {
      results.push({
        runId: delegateDeferredRunId(index),
        taskFingerprint: taskFingerprint(tasks[index].task),
        status: "deferred",
        error: "Deferred: a prior task hit the shared inference rate limit (3021). Re-run after it recovers.",
        attempts: 0,
        label: tasks[index].label,
      });
      continue;
    }
    let attempts = 0;
    let out: DelegateTaskOutcome;
    do {
      attempts++;
      out = await runTask(index);
      if (!shouldRetryDelegateAttempt(out.failure, attempts)) break;
    } while (true);
    results.push({
      runId: out.runId,
      taskFingerprint: taskFingerprint(tasks[index].task),
      status: out.status,
      summary: out.summary,
      output: out.output,
      error: out.error,
      attempts,
      label: tasks[index].label,
    });
    if (isRateLimitFailure(out.failure)) deferring = true; // backpressure: stop fan-out
  }
  return results;
}
