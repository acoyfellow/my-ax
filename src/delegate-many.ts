import { Think } from "@cloudflare/think";
import { tool, type ToolSet } from "ai";
import type { AgentToolFailure, RunAgentToolResult } from "agents/agent-tools";
import { z } from "zod";
import { resolveMyAxModel } from "./llm";
import {
  DELEGATE_MANY_LIMIT,
  stripOpenAiStoredItemRefs,
  delegateResultSchema,
  delegateRunId,
  runDelegatesInParallel,
  shouldRetryDelegate,
  taskFingerprint,
  type DelegateResult,
} from "./delegate-serial";
import type { Env } from "./types";
import type { AccessIdentity } from "./auth";
import { SandboxThinkWorkspace } from "./think-workspace";
import { ReadOnlyDelegateWorkspace, requireDelegateIdentity, splitDelegateRunInput } from "./read-only-delegate-workspace";

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

export const DELEGATE_TTL_MS = 60 * 60 * 1000;
export const DELEGATE_TIMEOUT_MS = 120_000;
export const DELEGATE_BATCH_DEADLINE_MS = 10 * 60_000;

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
  override workspace = new ReadOnlyDelegateWorkspace(
    () => this.getConfig<{ identity?: AccessIdentity }>()?.identity,
    (identity) => new SandboxThinkWorkspace(this.env, () => identity),
  );
  override async startAgentToolRun(input: unknown, options: { runId: string }) {
    const { task, identity } = splitDelegateRunInput(input);
    this.configure<{ identity?: AccessIdentity }>({ ...(this.getConfig<{ identity?: AccessIdentity }>() ?? {}), identity });
    return super.startAgentToolRun({ task }, options);
  }
  // Undefined -> resolveMyAxModel heals to defaultModelId(env): the resilient
  // gateway model on gateway installs, the Workers-AI fallback otherwise.
  getModel() { return resolveMyAxModel(this.env).model; }
  async beforeTurn(ctx: { messages: unknown[] }) {
    return {
      messages: stripOpenAiStoredItemRefs(ctx.messages) as never,
      providerOptions: { openai: { store: false } },
    };
  }
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
  delegateIdentity(): AccessIdentity | undefined;
  runAgentTool<Input, Output>(cls: typeof ReadOnlyDelegateAgent, options: { input: Input; runId: string; displayOrder: number; signal?: AbortSignal; inputPreview?: unknown }): Promise<RunAgentToolResult<Output>>;
  clearAgentToolRuns(options: { olderThan: number; status: Array<"completed" | "error" | "aborted" | "interrupted"> }): Promise<void>;
  notifyDelegateManyComplete?(results: DelegateResult[]): Promise<void>;
}

export function createDelegateManyTool(parent: DelegateParent) {
  return tool({
    description: "Delegate independent read-only analysis tasks. Split the work into as many independent tasks as it has (up to 1000) and send them in ONE call; they run in parallel. Only do work sequentially when a later task needs an earlier result. Rate limits are handled by adaptive backoff, not by asking for fewer tasks. The parent must synthesize the retained child evidence.",
    inputSchema: delegateManyInputSchema,
    outputSchema: delegateManyOutputSchema,
    execute: async (input, context) => {
      const parsed = delegateManyInputSchema.parse(input);
      const identity = requireDelegateIdentity(parent.delegateIdentity());
      const runIds = parsed.tasks.map(({ task }, index) => delegateRunId(parent.name, context.toolCallId, task, index));
      const deadlineAt = Date.now() + DELEGATE_BATCH_DEADLINE_MS;
      const results = await runDelegatesInParallel(parsed.tasks, async (index) => {
        const { task } = parsed.tasks[index];
        const timeout = AbortSignal.timeout(DELEGATE_TIMEOUT_MS);
        const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, timeout]) : timeout;
        const result = await parent.runAgentTool(ReadOnlyDelegateAgent, {
          input: { task, identity }, runId: runIds[index], displayOrder: index, signal, inputPreview: { task },
        });
        return {
          runId: result.runId,
          status: result.status,
          summary: result.summary,
          output: result.output,
          error: result.error,
          failure: asAgentToolFailure(result),
        };
      }, { deadline: () => Date.now() > deadlineAt });
      await parent.notifyDelegateManyComplete?.(results);
      await parent.clearAgentToolRuns({ olderThan: Date.now() - DELEGATE_TTL_MS, status: ["completed", "error", "aborted", "interrupted"] });
      return { results, synthesisRequired: true as const };
    },
  });
}
