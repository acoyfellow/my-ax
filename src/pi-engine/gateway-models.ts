import { createProvider, type MutableModels, type Provider } from "@earendil-works/pi-ai/models";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { Api, Model } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { gatewayConfig } from "../llm";
import type { Env } from "../types";

export const PI_GATEWAY_PROVIDER_ID = "myax-gateway";
export const PI_GATEWAY_MODEL_IDS = ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"] as const;
export const PI_ENGINE_GATEWAY_DEFAULT_MODEL = "claude-opus-5-5";
export const PI_GOOGLE_GATEWAY_PROVIDER_ID = "myax-gateway-google";
export const PI_GOOGLE_GATEWAY_MODEL_IDS = ["gemini-4-neon", "gemini-4-hydrogen"] as const;
export const GOOGLE_GATEWAY_API_KEY_PLACEHOLDER = "gateway";

export function googleGatewayBaseUrl(baseURL: string): string {
  return /\/openai\/?$/.test(baseURL) ? baseURL.replace(/\/openai\/?$/, "/google-ai-studio/v1beta") : `${baseURL.replace(/\/$/, "")}/google-ai-studio/v1beta`;
}

export function googleGatewayHeaders(headers: Record<string, string>): Record<string, string> {
  const accessToken = Object.entries(headers).find(([name]) => name.toLowerCase() === "cf-access-token")?.[1];
  const bearer = Object.entries(headers).find(([name]) => name.toLowerCase() === "authorization")?.[1]?.replace(/^Bearer\s+/i, "");
  const token = accessToken ?? bearer;
  const rest = Object.fromEntries(Object.entries(headers).filter(([name]) => !["authorization", "cf-access-token"].includes(name.toLowerCase())));
  return token ? { ...rest, "cf-access-token": token } : rest;
}

export function anthropicGatewayBaseUrl(baseURL: string): string {
  return /\/openai\/?$/.test(baseURL) ? baseURL.replace(/\/openai\/?$/, "/anthropic") : baseURL.replace(/\/$/, "");
}

export function gatewayRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const hasAuthorization = Object.keys(headers).some((name) => name.toLowerCase() === "authorization");
  if (hasAuthorization) return headers;
  const accessToken = Object.entries(headers).find(([name]) => name.toLowerCase() === "cf-access-token")?.[1];
  return accessToken ? { ...headers, authorization: `Bearer ${accessToken}` } : headers;
}

export function installGatewayModels(models: MutableModels, env: Env): boolean {
  let config: { baseURL: string; headers: Record<string, string> };
  try {
    config = gatewayConfig(env);
  } catch {
    return false;
  }
  const baseUrl = anthropicGatewayBaseUrl(config.baseURL);
  const headers = gatewayRequestHeaders(config.headers);
  const wanted = new Set<string>(PI_GATEWAY_MODEL_IDS);
  const catalog = anthropicProvider().getModels().filter((model) => wanted.has(model.id));
  if (!catalog.length) return false;
  models.setProvider(withRefusalFallback(createProvider({
    id: PI_GATEWAY_PROVIDER_ID,
    name: "My AX gateway",
    baseUrl,
    auth: { apiKey: { name: "My AX gateway", resolve: async () => ({ auth: { headers }, source: "gateway" }) } },
    models: catalog.map((model) => ({ ...model, provider: PI_GATEWAY_PROVIDER_ID, baseUrl })),
    api: anthropicMessagesApi(),
  })));
  installGoogleGatewayModels(models, config);
  return true;
}

export function installGoogleGatewayModels(models: MutableModels, config: { baseURL: string; headers: Record<string, string> }): boolean {
  const baseUrl = googleGatewayBaseUrl(config.baseURL);
  const headers = googleGatewayHeaders(config.headers);
  const wanted = new Set<string>(PI_GOOGLE_GATEWAY_MODEL_IDS);
  const catalog = googleProvider().getModels().filter((model) => wanted.has(model.id));
  if (!catalog.length) return false;
  models.setProvider(createProvider({
    id: PI_GOOGLE_GATEWAY_PROVIDER_ID,
    name: "My AX gateway (Google)",
    baseUrl,
    auth: { apiKey: { name: "My AX gateway (Google)", resolve: async () => ({ auth: { apiKey: GOOGLE_GATEWAY_API_KEY_PLACEHOLDER, headers }, source: "gateway" }) } },
    models: catalog.map((model) => ({ ...model, provider: PI_GOOGLE_GATEWAY_PROVIDER_ID, baseUrl })),
    api: googleGenerativeAIApi(),
  }));
  return true;
}

export function gatewayModelWindows(): Array<{ provider: string; id: string; contextWindow: number }> {
  const wanted = new Set<string>(PI_GATEWAY_MODEL_IDS);
  const google = new Set<string>(PI_GOOGLE_GATEWAY_MODEL_IDS);
  return [
    ...anthropicProvider().getModels().filter((model) => wanted.has(model.id)).map((model) => ({ provider: PI_GATEWAY_PROVIDER_ID, id: model.id, contextWindow: model.contextWindow })),
    ...googleProvider().getModels().filter((model) => google.has(model.id)).map((model) => ({ provider: PI_GOOGLE_GATEWAY_PROVIDER_ID, id: model.id, contextWindow: model.contextWindow })),
  ];
}

export type PiModelChoice = { provider: string; id: string; label: string };

export const PI_ENGINE_MODEL_CHOICES: readonly PiModelChoice[] = [
  { provider: PI_GATEWAY_PROVIDER_ID, id: "claude-opus-5-5", label: "Opus 5.5" },
  { provider: PI_GATEWAY_PROVIDER_ID, id: "claude-opus-5", label: "Opus 5" },
  { provider: PI_GATEWAY_PROVIDER_ID, id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { provider: PI_GOOGLE_GATEWAY_PROVIDER_ID, id: "gemini-4-neon", label: "Gemini 4 Neon" },
  { provider: PI_GOOGLE_GATEWAY_PROVIDER_ID, id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen" },
  { provider: "cloudflare", id: "@cf/zai-org/glm-5.3", label: "GLM 5.3" },
];

export const PI_REFUSAL_FALLBACK_CHAIN: Readonly<Record<string, string>> = {
  "claude-opus-5-5": "claude-opus-5",
  "claude-opus-5": "claude-sonnet-5-5",
};

export function isRefusal(message: { stopReason?: string; errorMessage?: string; content?: unknown[] }): boolean {
  if (message.stopReason !== "error") return false;
  return /usage policy|refus|violative/i.test(message.errorMessage ?? "");
}

function hasToolCall(message: { content?: unknown[] }): boolean {
  return Array.isArray(message.content) && message.content.some((block) => typeof block === "object" && block !== null && (block as { type?: unknown }).type === "toolCall");
}

export function refusalFallbackModel(modelId: string): string | undefined {
  return PI_REFUSAL_FALLBACK_CHAIN[modelId];
}

type StreamSimple = Provider["streamSimple"];

export function withRefusalFallback(provider: Provider): Provider {
  const streamWithFallback: StreamSimple = (model, context, options) => {
    const out = createAssistantMessageEventStream();
    void (async () => {
      let current: Model<Api> = model;
      for (;;) {
        const buffered: Parameters<typeof out.push>[0][] = [];
        let refused = false;
        for await (const event of provider.streamSimple(current, context, options)) {
          if (event.type === "error" && isRefusal(event.error) && !hasToolCall(event.error)) {
            const next = refusalFallbackModel(current.id);
            const nextModel = next ? provider.getModels().find((candidate) => candidate.id === next) : undefined;
            if (nextModel) {
              console.warn("pi_model_refusal_fallback", { from: current.id, to: nextModel.id });
              current = nextModel;
              refused = true;
              break;
            }
          }
          buffered.push(event);
          if (event.type !== "start") {
            for (const pending of buffered.splice(0)) out.push(pending);
          }
        }
        if (!refused) {
          for (const pending of buffered.splice(0)) out.push(pending);
          out.end();
          return;
        }
      }
    })().catch((error: unknown) => {
      console.error("pi_refusal_fallback_failed", { err: error instanceof Error ? error.message : String(error) });
      out.end();
    });
    return out;
  };
  return { ...provider, getModels: () => provider.getModels(), streamSimple: streamWithFallback };
}

const SETTINGS_MODEL_TO_PI: Readonly<Record<string, string>> = {
  "@cf/moonshotai/kimi-k3": "@cf/zai-org/glm-5.3",
  "@cf/moonshotai/kimi-k2.7-code": "@cf/zai-org/glm-5.3",
};

export function resolvePiModelChoice(settingsModelId: string): PiModelChoice | undefined {
  const id = SETTINGS_MODEL_TO_PI[settingsModelId] ?? settingsModelId;
  return PI_ENGINE_MODEL_CHOICES.find((choice) => choice.id === id);
}
