import { Think } from "@cloudflare/think";
import { tool, type ToolSet } from "ai";
import type { AgentToolFailure, RunAgentToolResult } from "agents/agent-tools";
import { z } from "zod";
import { resolveMyAxModel } from "./llm";
import { DEFAULT_MODEL_ID } from "./models";
import type { Env } from "./types";

export const DELEGATE_MANY_LIMIT = 2;
export const DELEGATE_TTL_MS = 60 * 60 * 1000;
export const DELEGATE_TIMEOUT_MS = 120_000;

export const delegateTaskSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  task: z.string().trim().min(1).max(4_000),
});
export const delegateManyInputSchema = z.object({
  tasks: z.array(delegateTaskSchema).min(1).max(DELEGATE_MANY_LIMIT),
});
export const delegateResultSchema = z.object({
  runId: z.string(),
  taskFingerprint: z.string(),
  label: z.string().max(80).optional(),
  status: z.enum(["completed", "error", "aborted", "interrupted"]),
  summary: z.string().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  attempts: z.number().int().min(1).max(2),
});
export const delegateManyOutputSchema = z.object({
  results: z.array(delegateResultSchema).max(DELEGATE_MANY_LIMIT),
  synthesisRequired: z.literal(true),
});
export type DelegateManyInput = z.infer<typeof delegateManyInputSchema>;
export type DelegateResult = z.infer<typeof delegateResultSchema>;

/** Stable, non-secret FNV-1a fingerprint. It is an idempotency key, not authentication. */
export function taskFingerprint(task: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(task.trim().replace(/\s+/g, " "))) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
export function delegateRunId(parentName: string, delegationId: string, task: string, index: number): string {
  // The parent tool-call ID is stable across replay but distinct for a later
  // delegation of the same text, avoiding stale retained-result reuse.
  return `delegate:${taskFingerprint(parentName)}:${taskFingerprint(delegationId)}:${index}:${taskFingerprint(task)}`;
}
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
export function shouldRetryDelegate(failure: AgentToolFailure, attempts: number): boolean {
  return failure.status === "interrupted" && failure.retryable && !failure.childStillRunning && attempts < 2;
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
}

export function createDelegateManyTool(parent: DelegateParent) {
  return tool({
    description: "Delegate one or two independent read-only analysis tasks concurrently. The parent must synthesize the retained child evidence.",
    inputSchema: delegateManyInputSchema,
    outputSchema: delegateManyOutputSchema,
    execute: async (input, context) => {
      const parsed = delegateManyInputSchema.parse(input);
      const runIds = parsed.tasks.map(({ task }, index) => delegateRunId(parent.name, context.toolCallId, task, index));
      const results = await Promise.all(parsed.tasks.map(async ({ task }, index): Promise<DelegateResult> => {
        let attempts = 0;
        let result: RunAgentToolResult<{ runId: string; summary: string }>;
        do {
          attempts++;
          const timeout = AbortSignal.timeout(DELEGATE_TIMEOUT_MS);
          const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, timeout]) : timeout;
          result = await parent.runAgentTool(ReadOnlyDelegateAgent, {
            input: { task }, runId: runIds[index], displayOrder: index, signal, inputPreview: { task },
          });
          const failure = asAgentToolFailure(result);
          if (!failure || !shouldRetryDelegate(failure, attempts)) break;
        } while (true);
        return { runId: result.runId, taskFingerprint: taskFingerprint(task), status: result.status, summary: result.summary, output: result.output, error: result.error, attempts, label: parsed.tasks[index].label };
      }));
      await parent.clearAgentToolRuns({ olderThan: Date.now() - DELEGATE_TTL_MS, status: ["completed", "error", "aborted", "interrupted"] });
      return { results, synthesisRequired: true as const };
    },
  });
}
