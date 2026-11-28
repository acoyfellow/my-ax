export const MAX_MODEL_LAYERS = 3;
export const LAYER_OPENER_DEADLINE_MS = 1_200;
export const LAYER_ROUTER_DEADLINE_MS = 600;
export const FALLBACK_LAYER_OPENER = "On it.";
export const MODEL_LAYERS_STORAGE_KEY = "my-ax-model-layers";
export const FAST_ROUTED_MODEL_ID = "gemini-4-hydrogen";
export const SLOW_FLAGSHIP_MODEL_IDS: ReadonlySet<string> = new Set([
  "claude-opus-5-5",
  "claude-opus-5",
  "gemini-4-neon",
  "gemini-4-carbon",
]);

export type ModelLayerKind = "fixed" | "clef" | "clef-router" | "clairic" | "chat";

export type ModelLayerOption = {
  readonly id: string;
  readonly label: string;
  readonly providerModel: string;
  readonly kind: ModelLayerKind;
  readonly p50Ms: number;
  readonly fast: boolean;
  readonly maxTokens?: number;
  readonly extra?: Readonly<Record<string, unknown>>;
};

export const MODEL_LAYER_OPTIONS: readonly ModelLayerOption[] = [
  { id: "fixed", label: "Fixed line + 👀 reaction · 0.0s", providerModel: "none", kind: "fixed", p50Ms: 0, fast: true },
  { id: "clef-flash", label: "Clef Flash (topic opener) · 0.15s p50", providerModel: "@cf/cloudflare/clef-flash", kind: "clef", p50Ms: 150, fast: true },
  { id: "clef-router", label: "Clef Flash Router (opener + fast tier) · 0.18s", providerModel: "@cf/cloudflare/clef-flash", kind: "clef-router", p50Ms: 180, fast: true },
  { id: "clef", label: "Clef (topic opener) · 0.20s p50", providerModel: "@cf/cloudflare/clef", kind: "clef", p50Ms: 200, fast: true },
  { id: "llama-3.1-8b", label: "Llama 3.1 8B Fast · 0.25s p50", providerModel: "@cf/meta/llama-3.1-8b-instruct-fast", kind: "chat", p50Ms: 250, fast: true, maxTokens: 32 },
  { id: "clairic-flash", label: "Clairic Flash (slot filler) · 0.30s p50", providerModel: "@cf/cloudflare/clairic-flash", kind: "clairic", p50Ms: 300, fast: true },
  { id: "clairic", label: "Clairic (slot filler) · 0.34s p50", providerModel: "@cf/cloudflare/clairic", kind: "clairic", p50Ms: 340, fast: true },
  { id: "phonellm-mini", label: "PhoneLLM Mini (guarded) · 0.37s p50", providerModel: "@cf/daily-co/phonellm-mini-alpha-2", kind: "chat", p50Ms: 370, fast: true, maxTokens: 32 },
  { id: "mistral-small-3.1", label: "Mistral Small 3.1 24B · 0.46s p50", providerModel: "@cf/mistralai/mistral-small-3.1-24b-instruct", kind: "chat", p50Ms: 460, fast: true, maxTokens: 32 },
  { id: "llama-3.3-70b", label: "Llama 3.3 70B Fast · 0.50s p50", providerModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", kind: "chat", p50Ms: 500, fast: true, maxTokens: 32 },
  { id: "gemma-4-26b", label: "Gemma 4 26B · timeout", providerModel: "@cf/google/gemma-4-26b-a4b-it", kind: "chat", p50Ms: 1200, fast: false, maxTokens: 32 },
  { id: "granite-4-micro", label: "Granite 4 Micro · timeout", providerModel: "@cf/ibm-granite/granite-4.0-h-micro", kind: "chat", p50Ms: 1200, fast: false, maxTokens: 32 },
  { id: "inkling-2-small", label: "Inkling 2 Small · timeout", providerModel: "@cf/thinkingmachines/inkling-2-small", kind: "chat", p50Ms: 1200, fast: false, maxTokens: 400, extra: { reasoning_effort: "none" } },
  { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash · timeout", providerModel: "@cf/deepseek-ai/deepseek-v4.1-flash-1017", kind: "chat", p50Ms: 1200, fast: false, maxTokens: 32 },
  { id: "gpt-oss-20b", label: "GPT-OSS 20B · timeout", providerModel: "@cf/openai/gpt-oss-20b", kind: "chat", p50Ms: 1200, fast: false, maxTokens: 300 },
];

export const VERIFIED_LAYER_OPTIONS: readonly ModelLayerOption[] = MODEL_LAYER_OPTIONS.filter((option) => option.fast);

export const DEFAULT_LAYER_IDS: readonly string[] = ["clef-flash", "clairic-flash", "llama-3.1-8b"];

const OPTIONS_BY_ID = new Map(MODEL_LAYER_OPTIONS.map((option) => [option.id, option]));

export function findModelLayerOption(id: string | undefined): ModelLayerOption | undefined {
  return id ? OPTIONS_BY_ID.get(id) : undefined;
}

export type ModelLayersConfig = {
  count: number;
  layers: string[];
  showMetrics: boolean;
};

export function defaultModelLayersConfig(): ModelLayersConfig {
  return { count: 0, layers: [...DEFAULT_LAYER_IDS], showMetrics: false };
}

export function sanitizeModelLayersConfig(raw: unknown): ModelLayersConfig {
  const base = defaultModelLayersConfig();
  if (!raw || typeof raw !== "object") return base;
  const record = raw as { count?: unknown; layers?: unknown; showMetrics?: unknown };
  const rawCount = typeof record.count === "number" && Number.isFinite(record.count) ? Math.trunc(record.count) : 0;
  const count = Math.max(0, Math.min(MAX_MODEL_LAYERS, rawCount));
  const inputLayers = Array.isArray(record.layers) ? record.layers : [];
  const layers = DEFAULT_LAYER_IDS.map((fallback, index) => {
    const candidate = typeof inputLayers[index] === "string" ? inputLayers[index] : "";
    return OPTIONS_BY_ID.has(candidate) ? candidate : fallback;
  });
  return { count, layers, showMetrics: record.showMetrics === true };
}

export function sanitizeLayerIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (out.length >= MAX_MODEL_LAYERS) break;
    if (typeof item === "string" && OPTIONS_BY_ID.has(item)) out.push(item);
  }
  return out;
}

export function activeLayerIds(config: ModelLayersConfig): string[] {
  return config.layers.slice(0, Math.max(0, Math.min(MAX_MODEL_LAYERS, config.count)));
}

export const MYAX_OPENER_TOPICS: Readonly<Record<string, string>> = {
  files: "Checking your files now.",
  computer: "Looking at your computer now.",
  web: "Checking the web now.",
  widgets: "Working on that view now.",
  schedule: "Checking your schedule now.",
  memory: "Checking my notes now.",
  other: "On it, looking now.",
};

export const MYAX_TOPIC_REACTIONS: Readonly<Record<string, string>> = {
  files: "📁",
  computer: "💻",
  web: "🌐",
  widgets: "🎨",
  schedule: "📅",
  memory: "🧠",
  other: "👀",
};

export function reactionForTool(toolName: string): string {
  const name = (toolName || "").toLowerCase();
  if (name === "ask_user") return "✋";
  if (name === "exec" || name.startsWith("machinectl") || name === "work_code") return "💻";
  if (name.startsWith("browser") || name === "web_search") return "🌐";
  if (name.includes("widget") || name.includes("artifact")) return "🎨";
  if (name.includes("job")) return "📅";
  if (name.includes("memory") || name.includes("conversation")) return "🧠";
  return "🔧";
}

export const REACTION_ACK_MIN_MS = 50;
export const REACTION_ACK_MAX_MS = 150;

export function reactionAckDelayMs(random: () => number = Math.random): number {
  const unit = Math.max(0, Math.min(0.999999, Number.isFinite(random()) ? random() : 0.5));
  return REACTION_ACK_MIN_MS + Math.floor(unit * (REACTION_ACK_MAX_MS - REACTION_ACK_MIN_MS + 1));
}

const PROMPT_REACTIONS: ReadonlyArray<{ pattern: RegExp; emoji: string; label: string }> = [
  { pattern: /\b(ship|deploy|push|publish|release|rollout|prod)\b/i, emoji: "🚀", label: "shipping" },
  { pattern: /\b(fix|bug|error|broken|crash|fail|debug|overlap|clip|bleed|issue)\b/i, emoji: "🔧", label: "fixing" },
  { pattern: /\b(design|ui|css|layout|style|theme|color|icon|widget|tile|sidebar|modal|responsive|emoji)\b/i, emoji: "🎨", label: "designing" },
  { pattern: /\b(test|verify|benchmark|measure|eval|speed|latency|audit|proof)\b/i, emoji: "🧪", label: "testing" },
  { pattern: /\b(search|find|lookup|grep|inspect|check|dig|scan|where)\b/i, emoji: "🔍", label: "looking" },
  { pattern: /\b(delete|remove|clean|prune|clear|wipe|reset|teardown)\b/i, emoji: "🧹", label: "cleaning" },
  { pattern: /\b(schedule|cron|recurring|remind|daily|weekly|alarm|timer)\b/i, emoji: "📅", label: "scheduling" },
  { pattern: /\b(email|notify|send|call|voice|speak|audio|mic)\b/i, emoji: "📣", label: "sending" },
  { pattern: /\b(run|shell|terminal|command|restart|kill|stop|laptop|machine|cmux|dev)\b/i, emoji: "💻", label: "running" },
  { pattern: /\b(build|create|implement|add|write|refactor|code|script|branch|feature|upgrade)\b/i, emoji: "🛠️", label: "building" },
  { pattern: /\b(readme|docs?|explain|eli5|how|why|summar|compact|context|memory|think|plan)\b/i, emoji: "🧠", label: "thinking" },
  { pattern: /^(hi|hey|hello|yo|sup|good morning|morning)\b/i, emoji: "👋", label: "hey" },
  { pattern: /^(go|yup|yep|ye|yes|ok|okay|sure|nice|thanks|thx|cool|awesome|love|do it)\b/i, emoji: "👍", label: "on it" },
];

export function reactionForPrompt(prompt: string, hasAttachments = false): { emoji: string; label: string } {
  const trimmed = (prompt || "").trim();
  if (!trimmed) return hasAttachments ? { emoji: "🖼️", label: "looking" } : { emoji: "👀", label: "seen" };
  for (const rule of PROMPT_REACTIONS) {
    if (rule.pattern.test(trimmed)) return { emoji: rule.emoji, label: rule.label };
  }
  if (hasAttachments) return { emoji: "🖼️", label: "looking" };
  return { emoji: "👀", label: "seen" };
}

export const CLAIRIC_OPENER_ACTIONS = ["Checking", "Writing", "Building", "Fixing", "Running", "Searching"] as const;

const UNSAFE_OPENER_PATTERN =
  /\b(just\s+(ran|executed|finished|completed|updated|fixed|created|deleted|sent|checked)|already\s+(ran|executed|finished|completed|done|fixed|checked)|i['’]?ve\s+(ran|run|executed|finished|completed|updated|fixed|created|checked)|done[!.]?$|completed|executed|found\s+\d+)\b|\b\d+\b/i;

export function isSafeOpenerText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return !UNSAFE_OPENER_PATTERN.test(trimmed);
}

export function sanitizeOpenerText(raw: string): string {
  const stripped = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/<\/?think>/gi, " ")
    .replace(/^["'`]+|["'`]+$/g, "");
  const line = stripped
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0) ?? "";
  if (!line) return "";
  const compact = line.replace(/\s+/g, " ").trim();
  const words = compact.split(" ");
  const clipped = words.length > 8 ? `${words.slice(0, 8).join(" ").replace(/[.,;:!?-]+$/, "")}.` : compact;
  return clipped.slice(0, 72).trim();
}

export type TurnLayerMetrics = {
  layers: string[];
  firstResponseMs: number | null;
  firstReasoningMs: number | null;
  approvalMs: number | null;
  finishMs: number | null;
  routedModel?: string | null;
};

function formatSec(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  return ms < 10_000 ? `${(ms / 1000).toFixed(2)}s` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatTurnLayerMetrics(metrics: TurnLayerMetrics): string {
  const parts = [
    `layers ${metrics.layers.length}`,
    ...(metrics.routedModel ? [`route ${metrics.routedModel}`] : []),
    `first ${formatSec(metrics.firstResponseMs)}`,
    `reasoning ${formatSec(metrics.firstReasoningMs)}`,
  ];
  if (metrics.approvalMs !== null) parts.push(`approval ${formatSec(metrics.approvalMs)}`);
  parts.push(`finish ${formatSec(metrics.finishMs)}`);
  return parts.join(" · ");
}
