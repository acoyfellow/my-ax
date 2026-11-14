import { generateText } from "ai";
import { z } from "zod";
import { resolveMyAxModel } from "./llm";
import {
  DELEGATE_MANY_LIMIT,
  delegateResultSchema,
  delegateRunId,
  runDelegatesInParallel,
  type DelegateResult,
} from "./delegate-serial";
import type { Env } from "./types";
import { deadlineSignal } from "./rpc/deadline-signal";
import { notifyOwner } from "./notify";
import { delegateCompletionNotification } from "./delegate-receipt";

export {
  DELEGATE_MANY_LIMIT,
  delegateResultSchema,
  delegateRunId,
  isRateLimitFailure,
  runDelegatesInParallel,
  shouldRetryDelegate,
  shouldRetryDelegateAttempt,
  taskFingerprint,
  type DelegateResult,
  type DelegateTaskOutcome,
} from "./delegate-serial";

export const DELEGATE_TIMEOUT_MS = 120_000;
export const DELEGATE_BATCH_DEADLINE_MS = 10 * 60_000;
export const DELEGATE_SYSTEM_PROMPT = "Complete only the bounded analysis task. Return evidence and a concise conclusion. You have no tools; do not claim to have changed anything.";

export const delegateTaskSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  task: z.string().trim().min(1).max(4_000),
});
export const delegateManyInputSchema = z.object({
  tasks: z.array(delegateTaskSchema).min(1).max(DELEGATE_MANY_LIMIT),
});
export const delegateManyOutputSchema = z.object({
  results: z.array(delegateResultSchema).max(DELEGATE_MANY_LIMIT),
  synthesisRequired: z.literal(true),
});
export type DelegateManyInput = z.infer<typeof delegateManyInputSchema>;

export const DELEGATE_MANY_DESCRIPTION = "Delegate independent read-only analysis tasks. Split the work into as many independent tasks as it has (up to 1000) and send them in ONE call; they run in parallel. Only do work sequentially when a later task needs an earlier result. Rate limits are handled by adaptive backoff, not by asking for fewer tasks. The parent must synthesize the retained child evidence.";

export type DelegateManyHost = { env: Env; ownerEmail: string; sessionId: string };

export async function runDelegateMany(host: DelegateManyHost, input: unknown, toolCallId: string, signal?: AbortSignal): Promise<string> {
  const parsed = delegateManyInputSchema.parse(input);
  const { model } = resolveMyAxModel(host.env);
  const deadlineAt = Date.now() + DELEGATE_BATCH_DEADLINE_MS;
  const results = await runDelegatesInParallel(parsed.tasks, async (index) => {
    const { task } = parsed.tasks[index];
    const runId = delegateRunId(host.sessionId, toolCallId, task, index);
    const deadline = deadlineSignal(DELEGATE_TIMEOUT_MS, signal);
    try {
      const reply = await generateText({ model, system: DELEGATE_SYSTEM_PROMPT, prompt: task, abortSignal: deadline.signal });
      return { runId, status: "completed" as const, summary: reply.text };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = deadline.signal.aborted ? "aborted" as const : "error" as const;
      return { runId, status, error: message, failure: { ok: false, status, error: message, retryable: false } };
    } finally {
      deadline.clear();
    }
  }, { deadline: () => Date.now() > deadlineAt });
  await notifyDelegateManyComplete(host, results);
  return JSON.stringify({ results, synthesisRequired: true });
}

async function notifyDelegateManyComplete(host: DelegateManyHost, results: DelegateResult[]): Promise<void> {
  if (results.length === 0) return;
  await notifyOwner(host.env, host.ownerEmail, delegateCompletionNotification({ sessionId: host.sessionId, results })).catch(() => undefined);
}
