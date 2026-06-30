// my-ax -> pantry bridge.
//
// Pushes my-ax's enabled saved_recipes — projected to the codemode-native
// snippet shape — to a live pantry (https://pantry.coey.dev by default) so
// a recipe authored in my-ax becomes reusable from a terrarium / Pi session
// through the pantry tool.
//
// Round 02 objection #3 — "pantry-sync.ts still maps D1 saved_recipes rows
// only; it does not publish snippets or snippet provenance" — is fixed
// by:
//   * reading from the cm_snippets projection (dual-read with saved_recipes
//     fallback so a fresh deploy that has not yet backfilled still
//     publishes), so each push carries the codemode-native shape
//     (name/description/code/inputSchema/connectors/savedAt) alongside the
//     authoritative capabilities tag list from saved_recipes;
//   * including snippet provenance fields (`codemodeExecutionId`,
//     `sourceRecipeId`, `provenance`) so the consumer (pantry) can tell
//     apart projected/transition data from native CodemodeRuntime
//     promotions without re-deriving;
//   * keeping the legacy `mapRecipeToPantryBody` export for callers that
//     still operate on raw saved_recipes rows.
//
// Design rules (so this never hurts my-ax):
//   - Additive. Nothing here is wired into a request path; callers opt in.
//   - Env-gated. Reads PANTRY_URL (default https://pantry.coey.dev) and
//     PANTRY_TOKEN. With no token it is a clear-logged no-op.
//   - Fail-soft. A network error, a rejected recipe, or a bad row is logged and
//     skipped; this function NEVER throws into a my-ax flow.
//   - The token is sent only in the Authorization header. It is never logged.

import type { Env } from "./types";
import { SavedRecipeService, type SavedRecipe } from "./saved-recipes";
import {
  listSnippetsDualRead,
  type PublicSnippet,
  type SnippetProvenance,
} from "./cm-snippets";

const DEFAULT_PANTRY_URL = "https://pantry.coey.dev";

// The body pantry's POST /recipes accepts. Now carries codemode-native
// snippet provenance so a downstream consumer can distinguish projected
// transition data from native CodemodeRuntime promotions.
export type PantryRecipeBody = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  code: string;
  capabilities: string[];
  status: "pending" | "enabled" | "disabled";
  sourceRunId: string | null;
  /** Codemode-native snippet provenance. */
  snippet: {
    codemodeExecutionId: string;
    sourceRecipeId: string | null;
    provenance: SnippetProvenance;
    connectors: string[];
    savedAt: number;
  };
};

export type PushResult =
  | { status: "skipped"; name: string; reason: string }
  | { status: "pushed"; name: string; version?: number; codemodeExecutionId?: string }
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

// Map one stored SavedRecipe row to a pantry POST body. Retained for
// callers that still want raw-row mapping; new code paths use
// `mapSnippetToPantryBody` for the codemode-native shape. Throws on a
// malformed row (bad JSON / zero capabilities) so the caller can skip
// it fail-soft.
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
  // Derive connector names from capability tags so the body carries the
  // codemode-native snippet shape even when called from the raw-row
  // path. The execution id falls back to the synthetic transition id
  // when no projection exists yet; isSyntheticExecutionId in cm-snippets
  // lets a consumer detect that.
  const connectors = [...new Set(capabilities.map((cap) => cap.split(".")[0]).filter(Boolean))].sort();
  const savedAt = Date.parse(recipe.created_at) || Date.now();
  return {
    name: recipe.name,
    description: recipe.description,
    inputSchema,
    code: recipe.code,
    // Honest passthrough: pantry stores these verbatim and grants nothing.
    capabilities,
    status: recipe.status,
    sourceRunId: recipe.source_run_id,
    snippet: {
      codemodeExecutionId: `cm_synth_${recipe.id}`,
      sourceRecipeId: recipe.id,
      provenance: "projected",
      connectors,
      savedAt,
    },
  };
}

/**
 * Map a cm_snippets projection row + the underlying saved_recipes record
 * to a pantry POST body. The snippet carries the codemode-native shape
 * (connectors / savedAt / executionId / provenance); the
 * authoritative `capabilities` tag list still comes from the saved
 * recipe row since the projection only stores connector names.
 */
export function mapSnippetToPantryBody(snippet: PublicSnippet, recipe: SavedRecipe): PantryRecipeBody {
  let capabilities: string[] = [];
  try {
    const parsed = JSON.parse(recipe.capabilities_json);
    if (Array.isArray(parsed)) capabilities = parsed.filter((c): c is string => typeof c === "string");
  } catch {
    throw new Error("capabilities_json is not valid JSON");
  }
  if (!capabilities.length) {
    throw new Error("snippet has zero capabilities; pantry requires a non-empty list");
  }
  const inputSchema = (snippet.inputSchema && typeof snippet.inputSchema === "object")
    ? (snippet.inputSchema as Record<string, unknown>)
    : { type: "object", properties: {} };
  return {
    name: snippet.name,
    description: snippet.description,
    inputSchema,
    code: snippet.code,
    capabilities,
    status: recipe.status,
    sourceRunId: recipe.source_run_id,
    snippet: {
      codemodeExecutionId: snippet.codemodeExecutionId,
      sourceRecipeId: snippet.sourceRecipeId,
      provenance: snippet.provenance,
      connectors: snippet.connectors ?? [],
      savedAt: snippet.savedAt,
    },
  };
}

// Push a single SavedRecipe row to pantry through the codemode-native
// snippet projection. Fail-soft: returns a PushResult instead of
// throwing. The token lives only in the Authorization header.
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
  return postRecipeBody(url, token, body, fetchImpl);
}

/**
 * Push a snippet projection to pantry. Used by syncSnippetsToPantry below
 * so the wire shape is the codemode-native snippet rather than the raw
 * saved_recipes row.
 */
export async function pushSnippet(
  env: Env,
  snippet: PublicSnippet,
  recipe: SavedRecipe,
  fetchImpl: typeof fetch = fetch,
): Promise<PushResult> {
  const { url, token } = pantryConfig(env);
  if (!token) {
    return { status: "skipped", name: snippet.name, reason: "PANTRY_TOKEN unset" };
  }
  if (recipe.status !== "enabled") {
    return { status: "skipped", name: snippet.name, reason: `status is ${recipe.status}` };
  }
  let body: PantryRecipeBody;
  try {
    body = mapSnippetToPantryBody(snippet, recipe);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("pantry_sync_skip", { recipe: snippet.name, reason });
    return { status: "skipped", name: snippet.name, reason };
  }
  return postRecipeBody(url, token, body, fetchImpl);
}

async function postRecipeBody(url: string, token: string, body: PantryRecipeBody, fetchImpl: typeof fetch): Promise<PushResult> {
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
      console.warn("pantry_sync_failed", { recipe: body.name, status: res.status });
      return { status: "failed", name: body.name, reason };
    }
    const json = (await res.json().catch(() => ({}))) as { name?: string; version?: number };
    console.log("pantry_sync_pushed", { recipe: body.name, version: json.version, codemodeExecutionId: body.snippet.codemodeExecutionId, provenance: body.snippet.provenance });
    return { status: "pushed", name: body.name, version: json.version, codemodeExecutionId: body.snippet.codemodeExecutionId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("pantry_sync_failed", { recipe: body.name, reason });
    return { status: "failed", name: body.name, reason };
  }
}

// Push every ENABLED saved recipe for an owner to pantry. No-op (clear log) when
// PANTRY_TOKEN is unset. Never throws into the my-ax flow.
//
// The function reads through the cm_snippets dual-read projection so each
// pushed body carries the codemode-native snippet shape + provenance. The
// authoritative capability list still comes from saved_recipes since the
// projection only stores connector names.
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
    const recipeByName = new Map<string, SavedRecipe>();
    for (const summary of summaries) {
      try {
        const row = await service.get(summary.id);
        recipeByName.set(summary.name, row);
      } catch {
        // Bad row: pantry_sync_failed logged below.
      }
    }
    const snippets = await listSnippetsDualRead(env, ownerEmail);
    const seen = new Set<string>();
    for (const snippet of snippets) {
      seen.add(snippet.name);
      const recipe = recipeByName.get(snippet.name);
      if (!recipe) {
        pushed.push({ status: "skipped", name: snippet.name, reason: "missing source saved_recipes row" });
        continue;
      }
      if (recipe.status !== "enabled") {
        pushed.push({ status: "skipped", name: snippet.name, reason: `status is ${recipe.status}` });
        continue;
      }
      pushed.push(await pushSnippet(env, snippet, recipe, fetchImpl));
    }
    // Any enabled saved_recipes row that did not appear in the snippet
    // projection still gets pushed (raw-row fallback) so a recipe added
    // but not yet projected still publishes.
    for (const summary of summaries) {
      if (seen.has(summary.name)) continue;
      if (summary.status !== "enabled") {
        pushed.push({ status: "skipped", name: summary.name, reason: `status is ${summary.status}` });
        continue;
      }
      const recipe = recipeByName.get(summary.name);
      if (!recipe) {
        pushed.push({ status: "failed", name: summary.name, reason: "saved_recipes row unreadable" });
        continue;
      }
      pushed.push(await pushRecipe(env, recipe, fetchImpl));
    }
  } catch (error) {
    // A DB failure or any unexpected error must not break my-ax.
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("pantry_sync_failed", { reason });
    return { configured: true, attempted: true, pushed };
  }
  return { configured: true, attempted: true, pushed };
}
