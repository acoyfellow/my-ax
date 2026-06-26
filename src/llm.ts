/** Model resolution for the curated my-ax catalog. The product UI exposes a
 * small Workers AI catalog so every visible row is usable by the public engine
 * without a private model gateway. */

import { createWorkersAI } from "workers-ai-provider";
import type { Env } from "./types";
import { DEFAULT_MODEL_ID, findModel, resolveModelId } from "./models";

export function resolveMyAxModel(env: Env, requestedModel?: string) {
  // Heal stale/removed model ids to the default rather than throwing every
  // turn. A session pinned to a churned model would otherwise look like a
  // permanent connection error to the user.
  const modelId = resolveModelId(requestedModel || DEFAULT_MODEL_ID);
  const meta = findModel(modelId)!;

  const model = createWorkersAI({
    binding: env.AI,
    ...(env.CLOUDFLARE_AI_GATEWAY_ID ? { gateway: { id: env.CLOUDFLARE_AI_GATEWAY_ID } } : {}),
  })(modelId as Parameters<ReturnType<typeof createWorkersAI>>[0]);

  return { modelId, meta, model };
}
