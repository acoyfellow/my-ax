import { FALLBACK_LAYER_OPENER, LAYER_OPENER_DEADLINE_MS, type TurnLayerMetrics } from "./model-layers";
import { runClefJointRouter, runFrontLayerOpener, type LayerAiBinding, type LayerFrame } from "./pi-engine/model-layers-runner";
import { NarrationThrottle, toolNarrationPhrase } from "./voice-narration";

export const VOICE_APPROVAL_LINE = "I need your OK before I change anything.";
export const VOICE_LAYER_POLL_MS = 250;
export const VOICE_LAYER_NARRATION_GAP_MS = 4_000;
export const VOICE_MAX_SPOKEN_SENTENCES = 2;

export type VoiceLayerMetrics = TurnLayerMetrics;

export type VoiceProgressEntry = { id: number; model?: unknown[] };

export type VoiceTurnProgress = {
  busy: boolean;
  lastEntryId: number;
  entries: VoiceProgressEntry[];
  partial: unknown | null;
};

export type VoiceLayerChat = {
  submit(text: string): Promise<{ operationId: string }>;
  wait(operationId: string): Promise<{ status: string; text?: string; reason?: string }>;
  voiceTurnProgress(sinceEntryId: number): Promise<VoiceTurnProgress>;
  broadcastFrame(frame: string): Promise<void>;
  abortAll(): Promise<unknown>;
};

export type VoiceLayerTurnOptions = {
  layers: readonly string[];
  transcript: string;
  chat: VoiceLayerChat;
  ai: LayerAiBinding | undefined;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
};

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/gu, " ")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gmu, "")
    .replace(/^\s*>\s?/gmu, "")
    .replace(/^\s*[-*•]\s+/gmu, "")
    .replace(/^\s*\d+[.)]\s+/gmu, "")
    .replace(/(\*\*|__|~~)/gu, "")
    .replace(/[*#|_]/gu, " ")
    .replace(/[ \t]*\n+[ \t]*/gu, " ")
    .replace(/\s{2,}/gu, " ");
}

export function extractCompleteSentences(markdown: string, finished: boolean): string[] {
  const text = stripMarkdown(markdown).trimStart();
  const sentences: string[] = [];
  const pattern = /[^.!?]*[.!?]+["')\]]*(?=\s)/gu;
  let consumed = 0;
  for (const match of text.matchAll(pattern)) {
    const sentence = match[0].trim();
    consumed = (match.index ?? 0) + match[0].length;
    if (/[\p{L}\p{N}]/u.test(sentence)) sentences.push(sentence);
  }
  const remainder = text.slice(consumed).trim();
  if (finished && /[\p{L}\p{N}]/u.test(remainder)) sentences.push(remainder);
  return sentences.slice(0, VOICE_MAX_SPOKEN_SENTENCES);
}

type Block = Record<string, unknown>;

function blocksOf(message: unknown): Block[] {
  if (!message || typeof message !== "object") return [];
  const content = (message as { content?: unknown }).content;
  return Array.isArray(content) ? (content as Block[]) : [];
}

function assistantMessages(entries: readonly VoiceProgressEntry[]): unknown[] {
  return entries.flatMap((entry) => (entry.model ?? []).filter((message) => (message as { role?: string })?.role === "assistant"));
}

function textOf(messages: readonly unknown[]): string {
  return messages
    .map((message) => blocksOf(message).filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text as string).join(""))
    .filter((text) => text.trim() !== "")
    .join("\n\n");
}

function toolCallsOf(messages: readonly unknown[]): Array<{ id: string; name: string }> {
  return messages.flatMap((message) =>
    blocksOf(message)
      .filter((block) => block.type === "toolCall" && typeof block.name === "string" && block.name !== "")
      .map((block, index) => ({ id: String(block.id ?? `${block.name}:${index}`), name: block.name as string })),
  );
}

async function runOpener(options: VoiceLayerTurnOptions): Promise<string> {
  try {
    if (options.layers.includes("clef-router")) {
      const decision = await runClefJointRouter(options.ai, options.transcript, "", false, { now: options.now });
      return decision.opener || FALLBACK_LAYER_OPENER;
    }
    const opener = await runFrontLayerOpener(options.ai, options.layers[0], options.transcript, { deadlineMs: LAYER_OPENER_DEADLINE_MS, now: options.now });
    return opener.text || FALLBACK_LAYER_OPENER;
  } catch {
    return FALLBACK_LAYER_OPENER;
  }
}

export async function* runLayeredVoiceTurn(options: VoiceLayerTurnOptions): AsyncGenerator<string> {
  const { layers, chat, signal } = options;
  if (layers.length === 0) return;
  const now = options.now ?? Date.now;
  const sleep = options.sleep;
  const waitPoll = async (ms: number, done: Promise<unknown>): Promise<void> => {
    if (sleep) {
      await Promise.race([sleep(ms), done.catch(() => undefined)]);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); }),
        done.catch(() => undefined),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  const pollMs = options.pollMs ?? VOICE_LAYER_POLL_MS;
  const startedAt = now();
  const elapsed = () => Math.max(0, now() - startedAt);
  const metrics: VoiceLayerMetrics = { layers: [...layers], firstResponseMs: null, firstReasoningMs: null, approvalMs: null, finishMs: null };
  const spoke = () => {
    if (metrics.firstResponseMs === null) metrics.firstResponseMs = elapsed();
  };

  const baseline = await chat.voiceTurnProgress(Number.MAX_SAFE_INTEGER);
  const sinceEntryId = baseline.lastEntryId;
  const openerPromise = runOpener(options);
  const donePromise = chat
    .submit(options.transcript)
    .then(async (receipt) => ({ receipt, result: await chat.wait(receipt.operationId) }));
  let settled = false;
  donePromise.then(() => { settled = true; }, () => { settled = true; });
  donePromise.catch(() => undefined);
  const stop = () => { void chat.abortAll().catch(() => undefined); };
  signal?.addEventListener("abort", stop, { once: true });

  try {
    const opener = await openerPromise;
    if (signal?.aborted) return;
    spoke();
    yield opener;

    const throttle = new NarrationThrottle(VOICE_LAYER_NARRATION_GAP_MS);
    const seenTools = new Set<string>();
    let approvalSpoken = false;
    let spokenSentences = 0;

    const drain = async function* (finished: boolean): AsyncGenerator<string> {
      const progress = await chat.voiceTurnProgress(sinceEntryId);
      const messages = assistantMessages(progress.entries);
      const partialMessages = progress.partial ? [progress.partial] : [];
      const lastEntryText = textOf(messages.slice(-1));
      const livePartial = partialMessages.filter((message) => textOf([message]) !== lastEntryText);
      for (const call of toolCallsOf([...messages, ...livePartial])) {
        if (seenTools.has(call.id)) continue;
        seenTools.add(call.id);
        if (call.name === "ask_user") {
          if (metrics.approvalMs === null) metrics.approvalMs = elapsed();
          if (!approvalSpoken) {
            approvalSpoken = true;
            spoke();
            yield VOICE_APPROVAL_LINE;
          }
          continue;
        }
        if (metrics.firstReasoningMs === null) metrics.firstReasoningMs = elapsed();
        const phrase = throttle.consider(call.name, now());
        if (phrase) {
          spoke();
          yield phrase.charAt(0).toUpperCase() + phrase.slice(1) + ".";
        }
      }
      const sentences = extractCompleteSentences(textOf([...messages, ...livePartial]), finished);
      while (spokenSentences < sentences.length) {
        spoke();
        yield sentences[spokenSentences];
        spokenSentences += 1;
      }
    };

    while (!settled && !signal?.aborted) {
      yield* drain(false);
      await waitPoll(pollMs, donePromise);
    }
    if (signal?.aborted) return;
    const outcome = await donePromise.catch((error: unknown) => ({ receipt: { operationId: crypto.randomUUID() }, result: { status: "error", text: undefined, reason: error instanceof Error ? error.message : String(error) } }));
    yield* drain(true);
    if (spokenSentences === 0) {
      const fallback = extractCompleteSentences(outcome.result.text ?? "", true);
      const lines = fallback.length > 0 ? fallback : [outcome.result.reason ? `The turn ended: ${outcome.result.reason}` : "Sorry, I didn't catch a response."];
      for (const line of lines) {
        spoke();
        yield line;
      }
    }
    metrics.finishMs = elapsed();
    const frame: LayerFrame = { type: "pi_layer", kind: "metrics", turnId: outcome.receipt.operationId, metrics: { ...metrics } };
    await chat.broadcastFrame(JSON.stringify(frame)).catch(() => undefined);
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}
