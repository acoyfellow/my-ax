import { Think } from "@cloudflare/think";
import { tool, type ToolSet } from "ai";
import type { AgentToolFailure, RunAgentToolResult } from "agents/agent-tools";
import { z } from "zod";
import { resolveMyAxModel } from "./llm";
import { DEFAULT_MODEL_ID } from "./models";
import {
  DELEGATE_MANY_LIMIT,
  delegateResultSchema,
  delegateRunId,
  runDelegatesSerially,
  shouldRetryDelegate,
  taskFingerprint,
  type DelegateResult,
} from "./delegate-serial";
import type { Env } from "./types";

// Pure retry/backpressure policy + serial orchestration live in delegate-serial.ts
// (no @cloudflare/think import) so they are unit-testable. Re-export the pieces
// other modules/tests already import from here.
export {
  DELEGATE_MANY_LIMIT,
  delegateResultSchema,
  delegateRunId,
  isRateLimitFailure,
  runDelegatesSerially,
  shouldRetryDelegate,
  shouldRetryDelegateAttempt,
  taskFingerprint,
  type DelegateResult,
  type DelegateTaskOutcome,
} from "./delegate-serial";

export const DELEGATE_TTL_MS = 60 * 60 * 1000;
export const DELEGATE_TIMEOUT_MS = 120_000;

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

export function asAgentToolFailure(result: RunAgentToolResult): AgentToolFailure | undefined {
  if (result.status === "completed") return undefined;
  return {
    ok: false,
    status: result.status,
    error: result.error ?? `Delegate ended with ${result.status}`,
    retryable: result.status === "interrupted",
    ...(result.status === "interrupted" ? { reason: result.reason, childStillRunning: result.childStillRunning } : {}),
  };
}

/** A run-scoped read-only Think facet. It deliberately has no delegation tool. */
export class ReadOnlyDelegateAgent extends Think<Env> {
  maxSteps = 8;
  workspaceBash = false;
  getModel() { return resolveMyAxModel(this.env, DEFAULT_MODEL_ID).model; }
  getSystemPrompt() {
    return "Complete only the bounded analysis task. Treat all available capabilities as read-only. Return evidence and a concise conclusion; do not mutate state or delegate.";
  }
  // Explicit capability profile: no application/MCP/browser/machine tools. Think's
  // retained transcript and read-only workspace inspection remain official evidence.
  getTools(): ToolSet { return {}; }
  protected override getAgentToolOutput(runId: string) {
    const message = [...this.messages].reverse().find((entry) => entry.role === "assistant");
    const summary = message?.parts.filter((part) => part.type === "text").map((part) => part.text).join("") ?? "";
    return { runId, summary };
  }
  protected override getAgentToolSummary(_runId: string, output: unknown) {
    return z.object({ summary: z.string() }).parse(output).summary;
  }
}

export interface DelegateParent {
  name: string;
  runAgentTool<Input, Output>(cls: typeof ReadOnlyDelegateAgent, options: { input: Input; runId: string; displayOrder: number; signal?: AbortSignal; inputPreview?: unknown }): Promise<RunAgentToolResult<Output>>;
  clearAgentToolRuns(options: { olderThan: number; status: Array<"completed" | "error" | "aborted" | "interrupted"> }): Promise<void>;
  notifyDelegateManyComplete?(results: DelegateResult[]): Promise<void>;
}

export function createDelegateManyTool(parent: DelegateParent) {
  return tool({
    // Runs the tasks SERIALLY (not concurrently): two child inferences hitting
    // the shared per-minute cap at once was the observed 3021 double-failure.
    // On 3021 the remaining task is deferred (backpressure), not retried.
    description: "Delegate one or two independent read-only analysis tasks (run sequentially to respect shared inference limits). The parent must synthesize the retained child evidence.",
    inputSchema: delegateManyInputSchema,
    outputSchema: delegateManyOutputSchema,
    execute: async (input, context) => {
      const parsed = delegateManyInputSchema.parse(input);
      const runIds = parsed.tasks.map(({ task }, index) => delegateRunId(parent.name, context.toolCallId, task, index));
      const results = await runDelegatesSerially(parsed.tasks, async (index) => {
        const { task } = parsed.tasks[index];
        const timeout = AbortSignal.timeout(DELEGATE_TIMEOUT_MS);
        const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, timeout]) : timeout;
        const result = await parent.runAgentTool(ReadOnlyDelegateAgent, {
          input: { task }, runId: runIds[index], displayOrder: index, signal, inputPreview: { task },
        });
        return {
          runId: result.runId,
          status: result.status,
          summary: result.summary,
          output: result.output,
          error: result.error,
          failure: asAgentToolFailure(result),
        };
      });
      await parent.notifyDelegateManyComplete?.(results);
      await parent.clearAgentToolRuns({ olderThan: Date.now() - DELEGATE_TTL_MS, status: ["completed", "error", "aborted", "interrupted"] });
      return { results, synthesisRequired: true as const };
    },
  });
}
