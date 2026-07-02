// Codemode snippets projection / dual-read layer.
//
// This module is the data seam between My AX's owner-curated D1 `saved_recipes`
// rows and the @cloudflare/codemode-native `Snippet` shape. It deliberately
// does NOT mirror saved_recipes into the CodemodeRuntime DO's `cm_snippets`
// SQLite facet: that facet only accepts `runtime.saveSnippet(name, {
// executionId })` with a codemode execution id from the same runtime
// execution log, and historical saved_recipes rows have no such id.
//
// Instead, we keep a parallel `cm_snippets` table in D1 that is:
//
//   * additive (saved_recipes remains the source of truth for owner
//     curation / REST / approval gating);
//   * dual-read (snippet lookups read from this projection first and fall
//     back to enabled saved_recipes if the projection is empty);
//   * idempotently backfilled (any enabled saved_recipes row materializes
//     a projection row on first read, keyed by (owner_email, name));
//   * provenance-honest (rows carry a `codemode_execution_id` that is
//     synthetic for transition data and only switches to a real native
//     CodemodeRuntime execution id when a future native run promotes it).
//
// The synthetic id format is `cm_synth_<recipeId>` so any caller — receipts,
// pantry-sync, cost accounting — can identify a projected snippet vs. a
// native one without guessing.

import type { Env } from "./types";
import type { SavedRecipe } from "./saved-recipes";
import type { Snippet } from "@cloudflare/codemode";

export type SnippetProvenance = "projected" | "native";

export type SnippetRow = {
  id: string;
  owner_email: string;
  name: string;
  description: string;
  code: string;
  input_schema_json: string;
  connectors_json: string;
  saved_at: number;
  source_recipe_id: string | null;
  codemode_execution_id: string;
  provenance: SnippetProvenance;
  created_at: string;
  updated_at: string;
};

export type PublicSnippet = Snippet & {
  id: string;
  sourceRecipeId: string | null;
  codemodeExecutionId: string;
  provenance: SnippetProvenance;
  capabilities: string[];
};

export const SYNTHETIC_EXECUTION_ID_PREFIX = "cm_synth_";

export function syntheticExecutionId(recipeId: string): string {
  return `${SYNTHETIC_EXECUTION_ID_PREFIX}${recipeId}`;
}

export function isSyntheticExecutionId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(SYNTHETIC_EXECUTION_ID_PREFIX);
}

/**
 * Connector names derived from a saved_recipes row's capability tags.
 * "workspace.read" -> "workspace", "machine.shell" -> "machine", etc.
 * Used so the projected snippet records which native codemode connectors
 * the historical row needs, matching `Snippet.connectors` semantics.
 */
export function connectorsFromCapabilities(capabilities: string[]): string[] {
  const connectors = new Set<string>();
  for (const cap of capabilities) {
    const idx = cap.indexOf(".");
    if (idx > 0) connectors.add(cap.slice(0, idx));
  }
  return [...connectors].sort();
}

export function rowToSnippet(row: SnippetRow): PublicSnippet {
  let inputSchema: unknown = { type: "object", properties: {} };
  try { inputSchema = JSON.parse(row.input_schema_json); } catch { /* keep default */ }
  let connectors: string[] = [];
  try {
    const parsed = JSON.parse(row.connectors_json);
    if (Array.isArray(parsed)) connectors = parsed.filter((c): c is string => typeof c === "string");
  } catch { /* empty */ }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    code: row.code,
    savedAt: row.saved_at,
    inputSchema,
    connectors,
    sourceRecipeId: row.source_recipe_id,
    codemodeExecutionId: row.codemode_execution_id,
    provenance: row.provenance,
    capabilities: connectors.length
      ? // Reconstruct best-effort capabilities from connector names so callers
        // that previously read `capabilities` keep getting non-empty arrays.
        // The authoritative capability list still lives on the saved_recipes
        // row; pantry-sync uses that one when present.
        connectors.map((c) => `${c}.*`)
      : [],
  };
}

/**
 * Project one saved_recipes row into the cm_snippets table. Idempotent: a
 * second projection of the same row updates code/description/inputSchema in
 * place but keeps the original codemode_execution_id and saved_at so a
 * downstream consumer reading the snippet does not see false "new save"
 * churn. Returns the resulting row.
 */
export async function projectSavedRecipe(env: Env, recipe: SavedRecipe): Promise<SnippetRow> {
  const owner = recipe.owner_email.toLowerCase();
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    "SELECT * FROM cm_snippets WHERE owner_email = ? AND name = ? LIMIT 1",
  ).bind(owner, recipe.name).first<SnippetRow>();
  let capabilities: string[] = [];
  try {
    const parsed = JSON.parse(recipe.capabilities_json);
    if (Array.isArray(parsed)) capabilities = parsed.filter((c): c is string => typeof c === "string");
  } catch { /* empty */ }
  const connectors = connectorsFromCapabilities(capabilities);
  const inputSchema = recipe.input_schema_json;
  if (existing) {
    await env.DB.prepare(
      `UPDATE cm_snippets SET description = ?, code = ?, input_schema_json = ?, connectors_json = ?, source_recipe_id = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(recipe.description, recipe.code, inputSchema, JSON.stringify(connectors), recipe.id, now, existing.id).run();
    return {
      ...existing,
      description: recipe.description,
      code: recipe.code,
      input_schema_json: inputSchema,
      connectors_json: JSON.stringify(connectors),
      source_recipe_id: recipe.id,
      updated_at: now,
    };
  }
  const id = crypto.randomUUID();
  const savedAt = Date.parse(recipe.created_at) || Date.now();
  const codemodeExecutionId = syntheticExecutionId(recipe.id);
  await env.DB.prepare(
    `INSERT INTO cm_snippets (id, owner_email, name, description, code, input_schema_json, connectors_json, saved_at, source_recipe_id, codemode_execution_id, provenance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'projected', ?, ?)`,
  ).bind(id, owner, recipe.name, recipe.description, recipe.code, inputSchema, JSON.stringify(connectors), savedAt, recipe.id, codemodeExecutionId, now, now).run();
  return {
    id,
    owner_email: owner,
    name: recipe.name,
    description: recipe.description,
    code: recipe.code,
    input_schema_json: inputSchema,
    connectors_json: JSON.stringify(connectors),
    saved_at: savedAt,
    source_recipe_id: recipe.id,
    codemode_execution_id: codemodeExecutionId,
    provenance: "projected",
    created_at: now,
    updated_at: now,
  };
}

/**
 * Backfill every enabled saved_recipes row for an owner into cm_snippets.
 * Idempotent: call any time, including after deploy. Returns the count of
 * rows projected or refreshed.
 */
export async function backfillOwnerSnippets(env: Env, ownerEmail: string): Promise<{ projected: number; refreshed: number }> {
  const owner = ownerEmail.toLowerCase();
  const { results = [] } = await env.DB.prepare(
    "SELECT * FROM saved_recipes WHERE owner_email = ? AND status = 'enabled'",
  ).bind(owner).all<SavedRecipe>();
  let projected = 0;
  let refreshed = 0;
  for (const recipe of results) {
    const existing = await env.DB.prepare(
      "SELECT id FROM cm_snippets WHERE owner_email = ? AND name = ? LIMIT 1",
    ).bind(owner, recipe.name).first<{ id: string }>();
    await projectSavedRecipe(env, recipe);
    if (existing) refreshed++; else projected++;
  }
  return { projected, refreshed };
}

/**
 * List snippets for an owner using dual-read: cm_snippets projection if
 * any rows exist, otherwise an in-memory projection of enabled
 * saved_recipes (without writing) so a brand-new deploy that has not yet
 * been migrated still serves snippets through the codemode-native
 * surface.
 */
export async function listSnippetsDualRead(env: Env, ownerEmail: string): Promise<PublicSnippet[]> {
  const owner = ownerEmail.toLowerCase();
  const { results = [] } = await env.DB.prepare(
    `SELECT c.* FROM cm_snippets c
     JOIN saved_recipes r ON r.owner_email = c.owner_email AND r.id = c.source_recipe_id
     WHERE c.owner_email = ? AND r.status = 'enabled'
     ORDER BY c.saved_at DESC`,
  ).bind(owner).all<SnippetRow>();
  if (results.length) return results.map(rowToSnippet);
  // Transition fallback: derive an ephemeral projection from saved_recipes
  // without writing. Receipts call backfillOwnerSnippets explicitly when
  // they want the projection persisted.
  const recipes = await env.DB.prepare(
    "SELECT * FROM saved_recipes WHERE owner_email = ? AND status = 'enabled' ORDER BY updated_at DESC",
  ).bind(owner).all<SavedRecipe>();
  return (recipes.results ?? []).map((recipe) => {
    let capabilities: string[] = [];
    try {
      const parsed = JSON.parse(recipe.capabilities_json);
      if (Array.isArray(parsed)) capabilities = parsed.filter((c): c is string => typeof c === "string");
    } catch { /* empty */ }
    const connectors = connectorsFromCapabilities(capabilities);
    let inputSchema: unknown = { type: "object", properties: {} };
    try { inputSchema = JSON.parse(recipe.input_schema_json); } catch { /* keep default */ }
    return {
      id: `transient_${recipe.id}`,
      name: recipe.name,
      description: recipe.description,
      code: recipe.code,
      savedAt: Date.parse(recipe.created_at) || Date.now(),
      inputSchema,
      connectors,
      sourceRecipeId: recipe.id,
      codemodeExecutionId: syntheticExecutionId(recipe.id),
      provenance: "projected" as const,
      capabilities,
    };
  });
}

/**
 * Look up one snippet for an owner by name through dual-read.
 */
export async function getSnippetDualRead(env: Env, ownerEmail: string, name: string): Promise<PublicSnippet | null> {
  const all = await listSnippetsDualRead(env, ownerEmail);
  return all.find((snippet) => snippet.name === name) ?? null;
}

/**
 * Resolve the canonical codemode execution id for a saved_recipes row.
 * Returns the projection's id if it exists, otherwise the synthetic
 * transition id. Receipts use this so a recipe.* run event always carries
 * a non-null `codemodeExecutionId` field — synthetic ids are clearly
 * marked via isSyntheticExecutionId so a reader can tell apart native
 * vs. transition data without inspecting the row.
 */
export async function codemodeExecutionIdForRecipe(env: Env, recipe: Pick<SavedRecipe, "id" | "name" | "owner_email">): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT codemode_execution_id FROM cm_snippets WHERE owner_email = ? AND source_recipe_id = ? LIMIT 1",
  ).bind(recipe.owner_email.toLowerCase(), recipe.id).first<{ codemode_execution_id: string }>().catch(() => null);
  return row?.codemode_execution_id ?? syntheticExecutionId(recipe.id);
}
