export const MAX_MODEL_LAYERS = 3;
export const LAYER_OPENER_DEADLINE_MS = 1_200;
export const FALLBACK_LAYER_OPENER = "On it.";
export const MODEL_LAYERS_STORAGE_KEY = "my-ax-model-layers";

export type ModelLayerKind = "fixed" | "clef" | "clairic" | "chat";

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
  { id: "fixed", label: "Fixed line (no model) · 0.0s", providerModel: "none", kind: "fixed", p50Ms: 0, fast: true },
  { id: "clef-flash", label: "Clef Flash · 0.15s p50", providerModel: "@cf/cloudflare/clef-flash", kind: "clef", p50Ms: 150, fast: true },
  { id: "llama-3.1-8b", label: "Llama 3.1 8B Fast · 0.17s p50", providerModel: "@cf/meta/llama-3.1-8b-instruct-fast", kind: "chat", p50Ms: 170, fast: true, maxTokens: 32 },
  { id: "clef", label: "Clef · 0.23s p50", providerModel: "@cf/cloudflare/clef", kind: "clef", p50Ms: 230, fast: true },
  { id: "clairic-flash", label: "Clairic Flash · 0.29s p50", providerModel: "@cf/cloudflare/clairic-flash", kind: "clairic", p50Ms: 290, fast: true },
  { id: "llama-3.3-70b", label: "Llama 3.3 70B Fast · 0.39s p50", providerModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", kind: "chat", p50Ms: 390, fast: true, maxTokens: 32 },
  { id: "gemma-4-26b", label: "Gemma 4 26B · 0.47s p50", providerModel: "@cf/google/gemma-4-26b-a4b-it", kind: "chat", p50Ms: 470, fast: false, maxTokens: 32 },
  { id: "phonellm-mini", label: "PhoneLLM Mini · 0.59s p50", providerModel: "@cf/daily-co/phonellm-mini-alpha-2", kind: "chat", p50Ms: 590, fast: false, maxTokens: 32 },
  { id: "mistral-small-3.1", label: "Mistral Small 3.1 24B · 0.61s p50", providerModel: "@cf/mistralai/mistral-small-3.1-24b-instruct", kind: "chat", p50Ms: 610, fast: false, maxTokens: 32 },
  { id: "clairic", label: "Clairic · 0.68s p50", providerModel: "@cf/cloudflare/clairic", kind: "clairic", p50Ms: 680, fast: false },
  { id: "granite-4-micro", label: "Granite 4 Micro · 1.0s p50", providerModel: "@cf/ibm-granite/granite-4.0-h-micro", kind: "chat", p50Ms: 1000, fast: false, maxTokens: 32 },
  { id: "inkling-2-small", label: "Inkling 2 Small · 1.0s p50", providerModel: "@cf/thinkingmachines/inkling-2-small", kind: "chat", p50Ms: 1000, fast: false, maxTokens: 400, extra: { reasoning_effort: "none" } },
  { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash · 1.1s p50", providerModel: "@cf/deepseek-ai/deepseek-v4.1-flash-1017", kind: "chat", p50Ms: 1100, fast: false, maxTokens: 32 },
  { id: "gpt-oss-20b", label: "GPT-OSS 20B · 1.5s p50", providerModel: "@cf/openai/gpt-oss-20b", kind: "chat", p50Ms: 1500, fast: false, maxTokens: 300 },
];

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

export const CLAIRIC_OPENER_ACTIONS = ["Checking", "Writing", "Building", "Fixing", "Running", "Searching"] as const;

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
};

function formatSec(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  return ms < 10_000 ? `${(ms / 1000).toFixed(2)}s` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatTurnLayerMetrics(metrics: TurnLayerMetrics): string {
  const parts = [
    `layers ${metrics.layers.length}`,
    `first ${formatSec(metrics.firstResponseMs)}`,
    `reasoning ${formatSec(metrics.firstReasoningMs)}`,
  ];
  if (metrics.approvalMs !== null) parts.push(`approval ${formatSec(metrics.approvalMs)}`);
  parts.push(`finish ${formatSec(metrics.finishMs)}`);
  return parts.join(" · ");
}
