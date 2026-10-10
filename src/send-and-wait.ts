export type SendAndWaitEntry = { id: number; role: string; content: string | null };

export type SendAndWaitDeps = {
  latestEntryId(): Promise<number>;
  inject(content: string): Promise<void>;
  isRunning(): Promise<boolean>;
  entriesAfter(id: number): Promise<SendAndWaitEntry[]>;
  sleep(ms: number): Promise<void>;
  now(): number;
};

export type SendAndWaitResult = {
  sessionId: string;
  done: boolean;
  timedOut: boolean;
  assistantText: string;
  entryIds: number[];
};

export const SEND_AND_WAIT_DEFAULT_TIMEOUT_MS = 120_000;
export const SEND_AND_WAIT_MAX_TIMEOUT_MS = 600_000;

export function parseSendAndWaitArgs(args: Record<string, unknown>) {
  const sessionId = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
  if (!sessionId) throw new Error("sessionId is required; send_and_wait never picks or creates a chat");
  const content = typeof args.content === "string" ? args.content.trim() : "";
  if (!content) throw new Error("content is required");
  const requested = Number(args.timeoutMs);
  const timeoutMs = Number.isFinite(requested) && requested > 0 ? Math.min(requested, SEND_AND_WAIT_MAX_TIMEOUT_MS) : SEND_AND_WAIT_DEFAULT_TIMEOUT_MS;
  return { sessionId, content, timeoutMs };
}

export async function sendAndWait(
  input: { sessionId: string; content: string; timeoutMs: number; pollMs?: number },
  deps: SendAndWaitDeps,
): Promise<SendAndWaitResult> {
  const pollMs = input.pollMs ?? 1000;
  const baseline = await deps.latestEntryId();
  const deadline = deps.now() + input.timeoutMs;
  await deps.inject(input.content);
  for (;;) {
    const entries = await deps.entriesAfter(baseline);
    const assistant = entries.filter((entry) => entry.role === "assistant");
    const running = await deps.isRunning();
    const done = !running && assistant.length > 0;
    const timedOut = !done && deps.now() >= deadline;
    if (done || timedOut) {
      return {
        sessionId: input.sessionId,
        done,
        timedOut,
        assistantText: assistant.map((entry) => entry.content ?? "").filter(Boolean).join("\n\n"),
        entryIds: entries.map((entry) => entry.id),
      };
    }
    await deps.sleep(pollMs);
  }
}
