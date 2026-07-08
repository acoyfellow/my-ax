/** Model resolution for the curated my-ax catalog. Model/provider routing is
 * deliberately invisible in the UI: users see model names, while the deploy
 * owner controls access through Workers AI and the configured gateway. */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createWorkersAI } from "workers-ai-provider";
import { createRetryFetch } from "./gateway-retry-fetch";
import type { Env } from "./types";
import { DEFAULT_MODEL_ID, findModel, resolveAvailableModelId } from "./models";

type GatewayEnv = {
  LLM_GATEWAY_URL?: string;
  LLM_GATEWAY_TOKEN?: string;
  LLM_GATEWAY_AUTH_HEADER?: string;
};

export function gatewayConfig(env: Env) {
  const e = env as unknown as GatewayEnv;
  const baseURL = e.LLM_GATEWAY_URL?.trim();
  const token = e.LLM_GATEWAY_TOKEN;
  if (!baseURL) throw new Error("This model requires the configured model gateway.");
  if (!token) throw new Error("This model requires LLM_GATEWAY_TOKEN.");
  const authHeader = e.LLM_GATEWAY_AUTH_HEADER?.trim() || "authorization";
  // Authorization tokens use the Bearer scheme. Cloudflare Access service/user
  // tokens in cf-access-token are already JWTs and must be sent verbatim.
  const authValue = authHeader.toLowerCase() === "authorization" ? `Bearer ${token}` : token;
  return {
    baseURL,
    headers: {
      [authHeader]: authValue,
      // Some Access-gated gateways require an explicit non-navigation request marker.
      "X-Requested-With": "xmlhttprequest",
    },
  };
}

function anthropicGatewayURL(baseURL: string): string {
  // A gateway may publish sibling OpenAI + Anthropic protocol endpoints. A
  // gateway may use /openai and /anthropic; a direct Anthropic endpoint can
  // simply be configured as-is.
  return /\/openai\/?$/.test(baseURL) ? baseURL.replace(/\/openai\/?$/, "/anthropic") : baseURL;
}

export function resolveMyAxModel(env: Env, requestedModel?: string) {
  // Heal stale/removed model ids to the default rather than throwing every
  // turn. A session pinned to a churned model would otherwise look like a
  // permanent connection error to the user.
  const modelId = resolveAvailableModelId(env, requestedModel || DEFAULT_MODEL_ID);
  const meta = findModel(modelId)!;

  let model;
  if (meta.route === "workers-ai") {
    model = createWorkersAI({
      binding: env.AI,
      ...(env.CLOUDFLARE_AI_GATEWAY_ID ? { gateway: { id: env.CLOUDFLARE_AI_GATEWAY_ID } } : {}),
    })(modelId as Parameters<ReturnType<typeof createWorkersAI>>[0]);
  } else if (meta.route === "gateway-anthropic") {
    const gateway = gatewayConfig(env);
    model = createAnthropic({
      baseURL: anthropicGatewayURL(gateway.baseURL),
      apiKey: "",
      headers: gateway.headers,
      // Transparently retry transient gateway rate limits (3021 / 429) with
      // bounded backoff so a per-minute cap blip self-heals instead of failing
      // the turn. See src/gateway-retry-fetch.ts (#6).
      fetch: createRetryFetch({ fetch: globalThis.fetch }),
    })(modelId);
  } else {
    const gateway = gatewayConfig(env);
    // The curated OpenAI/custom gateway models use the Responses protocol.
    model = createOpenAI({
      baseURL: gateway.baseURL,
      apiKey: "",
      headers: gateway.headers,
      fetch: createRetryFetch({ fetch: globalThis.fetch }),
    }).responses(modelId);
  }

  return { modelId, meta, model };
}
