// my-ax -> pantry bridge.
//
// Pushes my-ax's enabled saved_recipes to a live pantry (https://pantry.coey.dev
// by default) so a recipe authored in my-ax becomes reusable from a terrarium /
// Pi session through the pantry tool.
//
// Design rules (so this never hurts my-ax):
//   - Additive. Nothing here is wired into a request path; callers opt in.
//   - Env-gated. Reads PANTRY_URL (default https://pantry.coey.dev) and
//     PANTRY_TOKEN. With no token it is a clear-logged no-op.
//   - Fail-soft. A network error, a rejected recipe, or a bad row is logged and
//     skipped; this function NEVER throws into a my-ax flow.
//   - The token is sent only in the Authorization header. It is never logged.
//
// Mapping a SavedRecipe -> pantry POST /recipes body:
//   name        <- name
//   description <- description
//   inputSchema <- JSON.parse(input_schema_json)
//   code        <- code
//   capabilities<- JSON.parse(capabilities_json)
//
// Honest capability note: my-ax capabilities are workspace.*/machine.*/cloudbox.*
// tags. pantry stores them verbatim and grants NOTHING; the fetching caller
// decides whether the code is safe to run. We pass them through unchanged. A
// recipe with zero capabilities is skipped because pantry requires a non-empty
// list.

import type { Env } from "./types";
import { SavedRecipeService, type SavedRecipe } from "./saved-recipes";

const DEFAULT_PANTRY_URL = "https://pantry.coey.dev";

// The body pantry's POST /recipes accepts.
export type PantryRecipeBody = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  code: string;
  capabilities: string[];
  status: "enabled" | "disabled";
  sourceRunId: string | null;
};

export type PushResult =
  | { status: "skipped"; name: string; reason: string }
  | { status: "pushed"; name: string; version?: number }
  | { status: "failed"; name: string; reason: string };

export type SyncResult = {
  configured: boolean;
  pushed: PushResult[];
  // True only when PANTRY_TOKEN was present and we actually attempted pushes.
  attempted: boolean;
};

type PantryEnv = {
  PANTRY_URL?: string;
  PANTRY_TOKEN?: string;
};

function pantryConfig(env: Env): { url: string; token: string | undefined } {
  const raw = env as unknown as PantryEnv;
  const url = (raw.PANTRY_URL || DEFAULT_PANTRY_URL).replace(/\/$/, "");
  const token = raw.PANTRY_TOKEN || undefined;
  return { url, token };
}

// Map one stored SavedRecipe row to a pantry POST body. Throws on a malformed
// row (bad JSON / zero capabilities) so the caller can skip it fail-soft.
export function mapRecipeToPantryBody(recipe: SavedRecipe): PantryRecipeBody {
  let inputSchema: Record<string, unknown>;
  try {
    inputSchema = JSON.parse(recipe.input_schema_json);
  } catch {
    throw new Error("input_schema_json is not valid JSON");
  }
  let capabilities: string[];
  try {
    capabilities = JSON.parse(recipe.capabilities_json);
  } catch {
    throw new Error("capabilities_json is not valid JSON");
  }
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    throw new Error("recipe has zero capabilities; pantry requires a non-empty list");
  }
  return {
    name: recipe.name,
    description: recipe.description,
    inputSchema,
    code: recipe.code,
    // Honest passthrough: pantry stores these verbatim and grants nothing.
    capabilities,
    status: recipe.status,
    sourceRunId: recipe.source_run_id,
  };
}

// Push a single SavedRecipe row to pantry. Fail-soft: returns a PushResult
// instead of throwing. The token lives only in the Authorization header.
export async function pushRecipe(
  env: Env,
  recipe: SavedRecipe,
  fetchImpl: typeof fetch = fetch,
): Promise<PushResult> {
  const { url, token } = pantryConfig(env);
  if (!token) {
    return { status: "skipped", name: recipe.name, reason: "PANTRY_TOKEN unset" };
  }
  if (recipe.status !== "enabled") {
    return { status: "skipped", name: recipe.name, reason: `status is ${recipe.status}` };
  }
  let body: PantryRecipeBody;
  try {
    body = mapRecipeToPantryBody(recipe);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("pantry_sync_skip", { recipe: recipe.name, reason });
    return { status: "skipped", name: recipe.name, reason };
  }
  try {
    const res = await fetchImpl(`${url}/recipes`, {
      method: "POST",
      headers: {
        // Token ONLY here; never logged.
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const reason = `pantry push failed: ${res.status} ${detail}`.trim();
      console.warn("pantry_sync_failed", { recipe: recipe.name, status: res.status });
      return { status: "failed", name: recipe.name, reason };
    }
    const json = (await res.json().catch(() => ({}))) as { name?: string; version?: number };
    console.log("pantry_sync_pushed", { recipe: recipe.name, version: json.version });
    return { status: "pushed", name: recipe.name, version: json.version };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("pantry_sync_failed", { recipe: recipe.name, reason });
    return { status: "failed", name: recipe.name, reason };
  }
}

// Push every ENABLED saved recipe for an owner to pantry. No-op (clear log) when
// PANTRY_TOKEN is unset. Never throws into the my-ax flow.
export async function syncRecipesToPantry(
  env: Env,
  ownerEmail: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SyncResult> {
  const { url, token } = pantryConfig(env);
  if (!token) {
    console.log("pantry_sync_noop", { reason: "PANTRY_TOKEN unset", url });
    return { configured: false, attempted: false, pushed: [] };
  }
  const pushed: PushResult[] = [];
  try {
    const service = new SavedRecipeService(env, ownerEmail);
    const summaries = await service.list();
    for (const summary of summaries) {
      if (summary.status !== "enabled") {
        pushed.push({ status: "skipped", name: summary.name, reason: `status is ${summary.status}` });
        continue;
      }
      // list() drops `code`; fetch the full row so we can push the script.
      let row: SavedRecipe;
      try {
        row = await service.get(summary.id);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        pushed.push({ status: "failed", name: summary.name, reason });
        continue;
      }
      pushed.push(await pushRecipe(env, row, fetchImpl));
    }
  } catch (error) {
    // A DB failure or any unexpected error must not break my-ax.
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("pantry_sync_failed", { reason });
    return { configured: true, attempted: true, pushed };
  }
  return { configured: true, attempted: true, pushed };
}
