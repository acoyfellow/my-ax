import { createProvider, type MutableModels } from "@earendil-works/pi-ai/models";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { gatewayConfig } from "../llm";
import type { Env } from "../types";

export const PI_GATEWAY_PROVIDER_ID = "myax-gateway";
export const PI_GATEWAY_MODEL_IDS = ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"] as const;
export const PI_ENGINE_GATEWAY_DEFAULT_MODEL = "claude-opus-5-5";

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
  models.setProvider(createProvider({
    id: PI_GATEWAY_PROVIDER_ID,
    name: "My AX gateway",
    baseUrl,
    auth: { apiKey: { name: "My AX gateway", resolve: async () => ({ auth: { headers }, source: "gateway" }) } },
    models: catalog.map((model) => ({ ...model, provider: PI_GATEWAY_PROVIDER_ID, baseUrl })),
    api: anthropicMessagesApi(),
  }));
  return true;
}

export type PiModelChoice = { provider: string; id: string; label: string };

export const PI_ENGINE_MODEL_CHOICES: readonly PiModelChoice[] = [
  { provider: PI_GATEWAY_PROVIDER_ID, id: "claude-opus-5-5", label: "Opus 5.5" },
  { provider: PI_GATEWAY_PROVIDER_ID, id: "claude-opus-5", label: "Opus 5" },
  { provider: PI_GATEWAY_PROVIDER_ID, id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { provider: "cloudflare", id: "@cf/zai-org/glm-5.3", label: "GLM 5.3" },
];
