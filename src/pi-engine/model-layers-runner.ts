import {
  CLAIRIC_OPENER_ACTIONS,
  FALLBACK_LAYER_OPENER,
  FAST_ROUTED_MODEL_ID,
  findModelLayerOption,
  isSafeOpenerText,
  LAYER_OPENER_DEADLINE_MS,
  LAYER_ROUTER_DEADLINE_MS,
  MYAX_OPENER_TOPICS,
  MYAX_TOPIC_REACTIONS,
  reactionForTool,
  sanitizeOpenerText,
  SLOW_FLAGSHIP_MODEL_IDS,
  type ModelLayerOption,
  type TurnLayerMetrics,
} from "../model-layers";
import { NarrationThrottle } from "../voice-narration";
import type { ViewEvent } from "./view-events";

export type LayerAiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

export type LayerFrame =
  | { type: "pi_layer"; kind: "opener"; turnId: string; layerIndex: number; layerId: string; text: string; reaction?: string; ms: number; fellBack: boolean }
  | { type: "pi_layer"; kind: "reaction"; turnId: string; emoji: string; label?: string }
  | { type: "pi_layer"; kind: "route"; turnId: string; route: "fast" | "worker"; targetModel: string; topic: string; ms: number }
  | { type: "pi_layer"; kind: "status"; turnId: string; text: string; toolName: string; reaction?: string; approval?: boolean }
  | { type: "pi_layer"; kind: "metrics"; turnId: string; metrics: TurnLayerMetrics };

type ChatReply = { readonly response?: string; readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: string | null } }> };
type ClefReply = { readonly answers?: Record<string, { readonly choice?: string; readonly value?: boolean }> };
type ClairicReply = { readonly answers?: Record<string, { readonly value?: unknown }> };

const OPENER_SYSTEM_PROMPT =
  "You are the fast spoken opener for a personal assistant that just started working on the user's request. Say what you are about to do in present progressive first person, in one line under 8 words. Never claim you finished, never use past tense, and never state any fact or number. Examples: Checking your files now. Looking into that now.";

function chatContentOf(reply: ChatReply): string {
  return (reply.response ?? reply.choices?.[0]?.message?.content ?? "").trim();
}

export type ClefRouteDecision = {
  readonly topic: string;
  readonly opener: string;
  readonly reaction: string;
  readonly route: "fast" | "worker";
  readonly targetModel: string;
  readonly ms: number;
  readonly fellBack: boolean;
};

export async function runClefJointRouter(
  ai: LayerAiBinding | undefined,
  userText: string,
  requestedModel: string,
  hasAttachments: boolean,
  options?: { deadlineMs?: number; now?: () => number },
): Promise<ClefRouteDecision> {
  const now = options?.now ?? Date.now;
  const started = now();
  const canFastRoute = !hasAttachments && SLOW_FLAGSHIP_MODEL_IDS.has(requestedModel);
  const fallback: ClefRouteDecision = {
    topic: "other",
    opener: MYAX_OPENER_TOPICS.other,
    reaction: MYAX_TOPIC_REACTIONS.other,
    route: "worker",
    targetModel: requestedModel,
    ms: 0,
    fellBack: true,
  };
  if (!ai) return { ...fallback, ms: Math.max(0, now() - started) };
  const deadlineMs = options?.deadlineMs ?? LAYER_ROUTER_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      ai
        .run("@cf/cloudflare/clef-flash", {
          state: userText.slice(0, 600),
          questions: {
            topic: {
              type: "choice",
              instructions: "What is this assistant request mainly about?",
              criteria: Object.fromEntries(Object.keys(MYAX_OPENER_TOPICS).map((topic) => [topic, `The request is mainly about ${topic}`])),
            },
            needs_worker: {
              type: "noul",
              instructions: "Does this request need tools, shell commands, reading files, web browsing, memory lookup, building code/widgets, or deep reasoning?",
              criteria: {
                true: "Needs tools, files, shell, computer, web, past chat context, code generation, or deep multi-step thinking.",
                false: "A trivial self-contained question (simple definition, quick math, rephrasing, greeting) answerable in one shot with zero tools or context.",
              },
            },
          },
        })
        .catch(() => null) as Promise<ClefReply | null>,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deadlineMs);
      }),
    ]);
    const ms = Math.max(0, now() - started);
    if (!reply?.answers) return { ...fallback, ms };
    const rawTopic = reply.answers.topic?.choice ?? "other";
    const topic = rawTopic in MYAX_OPENER_TOPICS ? rawTopic : "other";
    const needsWorker = reply.answers.needs_worker?.value !== false;
    const useFast = canFastRoute && !needsWorker && topic === "other";
    return {
      topic,
      opener: useFast ? "Answering now." : MYAX_OPENER_TOPICS[topic],
      reaction: useFast ? "⚡" : MYAX_TOPIC_REACTIONS[topic],
      route: useFast ? "fast" : "worker",
      targetModel: useFast ? FAST_ROUTED_MODEL_ID : requestedModel,
      ms,
      fellBack: false,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function callLayerOption(ai: LayerAiBinding | undefined, option: ModelLayerOption, userText: string): Promise<{ text: string; reaction?: string }> {
  if (option.kind === "fixed") return { text: MYAX_OPENER_TOPICS.other, reaction: "👀" };
  if (!ai) return { text: "" };
  if (option.kind === "clef" || option.kind === "clef-router") {
    const reply = (await ai.run(option.providerModel, {
      state: userText.slice(0, 600),
      questions: {
        topic: {
          type: "choice",
          instructions: "What is this assistant request mainly about?",
          criteria: Object.fromEntries(Object.keys(MYAX_OPENER_TOPICS).map((topic) => [topic, `The request is mainly about ${topic}`])),
        },
      },
    })) as ClefReply;
    const rawTopic = reply?.answers?.topic?.choice ?? "other";
    const topic = rawTopic in MYAX_OPENER_TOPICS ? rawTopic : "other";
    return { text: MYAX_OPENER_TOPICS[topic], reaction: MYAX_TOPIC_REACTIONS[topic] };
  }
  if (option.kind === "clairic") {
    const reply = (await ai.run(option.providerModel, {
      state: userText.slice(0, 600),
      fields: {
        action: { type: "enum", enum: CLAIRIC_OPENER_ACTIONS, nullable: false, instructions: "What the user wants done" },
        thing: { type: "text", nullable: false, instructions: "Short object of the request, 1 to 3 lowercase words, e.g. sidebar layout, tests, notes" },
      },
    })) as ClairicReply;
    const action = String(reply?.answers?.action?.value ?? "").trim();
    const thing = String(reply?.answers?.thing?.value ?? "").trim();
    return { text: action && thing ? `${action} ${thing} now.` : "" };
  }
  const reply = (await ai.run(option.providerModel, {
    messages: [
      { role: "system", content: OPENER_SYSTEM_PROMPT },
      { role: "user", content: userText.slice(0, 600) },
    ],
    max_tokens: option.maxTokens ?? 32,
    ...(option.extra ?? {}),
  })) as ChatReply;
  return { text: chatContentOf(reply ?? {}) };
}

export async function runFrontLayerOpener(
  ai: LayerAiBinding | undefined,
  layerId: string,
  userText: string,
  options?: { deadlineMs?: number; now?: () => number },
): Promise<{ text: string; reaction?: string; ms: number; fellBack: boolean; layerId: string }> {
  const now = options?.now ?? Date.now;
  const started = now();
  const option = findModelLayerOption(layerId);
  if (!option) return { text: FALLBACK_LAYER_OPENER, ms: Math.max(0, now() - started), fellBack: true, layerId };
  if (option.kind === "fixed") return { text: MYAX_OPENER_TOPICS.other, reaction: "👀", ms: Math.max(0, now() - started), fellBack: false, layerId };
  const deadlineMs = options?.deadlineMs ?? LAYER_OPENER_DEADLINE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw: { text: string; reaction?: string } = await Promise.race([
      callLayerOption(ai, option, userText).catch((): { text: string; reaction?: string } => ({ text: "" })),
      new Promise<{ text: string; reaction?: string }>((resolve) => {
        timer = setTimeout(() => resolve({ text: "" }), deadlineMs);
      }),
    ]);
    const sanitized = sanitizeOpenerText(raw.text);
    const safe = option.kind === "chat" ? isSafeOpenerText(sanitized) : sanitized.length > 0;
    const ms = Math.max(0, now() - started);
    if (!safe) return { text: FALLBACK_LAYER_OPENER, reaction: raw.reaction, ms, fellBack: true, layerId };
    return { text: sanitized, reaction: raw.reaction, ms, fellBack: false, layerId };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function capitalizeSentence(phrase: string): string {
  const trimmed = phrase.trim();
  if (!trimmed) return "";
  const lead = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(lead) ? lead : `${lead}.`;
}

export class LayerTurnController {
  readonly turnId: string;
  readonly layers: string[];
  readonly startedAt: number;
  private readonly clock: () => number;
  private readonly throttle: NarrationThrottle;
  private workerResponded = false;
  private stopped = false;
  private highestEmittedLayer = 0;
  private seenToolCalls = new Set<string>();
  private turnErrored = false;
  readonly metrics: TurnLayerMetrics;

  constructor(turnId: string, layers: readonly string[], options?: { now?: () => number; statusGapMs?: number; routedModel?: string | null }) {
    this.turnId = turnId;
    this.layers = [...layers];
    this.clock = options?.now ?? Date.now;
    this.startedAt = this.clock();
    this.throttle = new NarrationThrottle(options?.statusGapMs ?? 2_500);
    this.metrics = {
      layers: [...layers],
      firstResponseMs: null,
      firstReasoningMs: null,
      approvalMs: null,
      finishMs: null,
      ...(options?.routedModel ? { routedModel: options.routedModel } : {}),
    };
  }

  private elapsed(): number {
    return Math.max(0, this.clock() - this.startedAt);
  }

  stop(): void {
    this.stopped = true;
  }

  recordPrecomputedOpener(layerIndex: number, layerId: string, text: string, reaction: string, ms: number, fellBack: boolean, emit: (frame: LayerFrame) => void): void {
    if (this.stopped || this.workerResponded) return;
    if (layerIndex < this.highestEmittedLayer) return;
    this.highestEmittedLayer = layerIndex;
    if (this.metrics.firstResponseMs === null) this.metrics.firstResponseMs = this.elapsed();
    emit({ type: "pi_layer", kind: "opener", turnId: this.turnId, layerIndex, layerId, text, reaction, ms, fellBack });
  }

  async start(
    ai: LayerAiBinding | undefined,
    userText: string,
    emit: (frame: LayerFrame) => void,
    deadlineMs = LAYER_OPENER_DEADLINE_MS,
    skipIndexes?: ReadonlySet<number>,
  ): Promise<void> {
    if (!this.layers.length) return;
    await Promise.all(
      this.layers.map(async (layerId, index) => {
        const layerIndex = index + 1;
        if (skipIndexes?.has(layerIndex)) return;
        const result = await runFrontLayerOpener(ai, layerId, userText, { deadlineMs, now: this.clock });
        if (this.stopped || this.workerResponded) return;
        if (layerIndex < this.highestEmittedLayer) return;
        if (result.fellBack && this.highestEmittedLayer > 0) return;
        this.highestEmittedLayer = layerIndex;
        if (this.metrics.firstResponseMs === null) this.metrics.firstResponseMs = this.elapsed();
        emit({
          type: "pi_layer",
          kind: "opener",
          turnId: this.turnId,
          layerIndex,
          layerId,
          text: result.text,
          ...(result.reaction ? { reaction: result.reaction } : {}),
          ms: result.ms,
          fellBack: result.fellBack,
        });
      }),
    );
  }

  onViewEvents(events: readonly ViewEvent[], emit: (frame: LayerFrame) => void): boolean {
    if (this.stopped) return true;
    for (const event of events) {
      if (event.type === "message_update") {
        const changes = Array.isArray(event.changes) ? (event.changes as Array<Record<string, unknown>>) : [];
        for (const change of changes) {
          if (change.type === "thinking_delta" && this.metrics.firstReasoningMs === null) {
            this.metrics.firstReasoningMs = this.elapsed();
          }
          if (change.type === "text_delta" && typeof change.delta === "string" && change.delta.trim()) {
            this.workerResponded = true;
            if (this.metrics.firstResponseMs === null) this.metrics.firstResponseMs = this.elapsed();
          }
          if (change.type === "message" && change.message && typeof change.message === "object") {
            this.observeAssistantMessage(change.message as Record<string, unknown>, emit);
          }
        }
      }
      if (event.type === "entry_appended") {
        const entry = event.entry as { model?: Array<Record<string, unknown>> } | undefined;
        for (const message of entry?.model ?? []) {
          if (message.role === "assistant") this.observeAssistantMessage(message, emit);
        }
      }
      if (event.type === "message_end") {
        const msg = event.message as { stopReason?: string } | undefined;
        if (msg?.stopReason === "error") this.turnErrored = true;
      }
      if (event.type === "run_end") {
        this.stopped = true;
        this.metrics.finishMs = this.elapsed();
        emit({ type: "pi_layer", kind: "reaction", turnId: this.turnId, emoji: this.turnErrored ? "⚠️" : "✅", label: this.turnErrored ? "failed" : "done" });
        emit({ type: "pi_layer", kind: "metrics", turnId: this.turnId, metrics: { ...this.metrics } });
        return true;
      }
    }
    return false;
  }

  private observeAssistantMessage(message: Record<string, unknown>, emit: (frame: LayerFrame) => void): void {
    if (message.stopReason === "error") this.turnErrored = true;
    const content = Array.isArray(message.content) ? (message.content as Array<Record<string, unknown>>) : [];
    for (const block of content) {
      if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
        if (this.metrics.firstReasoningMs === null) this.metrics.firstReasoningMs = this.elapsed();
      }
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        this.workerResponded = true;
        if (this.metrics.firstResponseMs === null) this.metrics.firstResponseMs = this.elapsed();
      }
      if (block.type === "toolCall") {
        const id = String(block.id ?? "");
        const name = String(block.name ?? "");
        if (!name || (id && this.seenToolCalls.has(id))) continue;
        if (id) this.seenToolCalls.add(id);
        this.workerResponded = true;
        if (this.metrics.firstReasoningMs === null) this.metrics.firstReasoningMs = this.elapsed();
        const emoji = reactionForTool(name);
        if (name === "ask_user") {
          if (this.metrics.approvalMs === null) this.metrics.approvalMs = this.elapsed();
          emit({
            type: "pi_layer",
            kind: "status",
            turnId: this.turnId,
            text: "Needs your approval before continuing.",
            toolName: name,
            reaction: emoji,
            approval: true,
          });
          continue;
        }
        const phrase = this.throttle.consider(name, this.clock());
        if (phrase) {
          if (this.metrics.firstResponseMs === null) this.metrics.firstResponseMs = this.elapsed();
          emit({
            type: "pi_layer",
            kind: "status",
            turnId: this.turnId,
            text: capitalizeSentence(phrase),
            toolName: name,
            reaction: emoji,
          });
        }
      }
    }
  }
}
