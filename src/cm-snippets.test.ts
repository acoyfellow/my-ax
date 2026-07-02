// Behavioral tests for the codemode snippet projection / dual-read seam.
//
// These exercise actual SQL paths against an in-memory D1-shaped mock so the
// transition seam (saved_recipes → cm_snippets projection) is verified end
// to end: backfill, idempotent re-projection, dual-read fallback, and the
// synthetic codemode execution id contract.

import assert from "node:assert/strict";
import test from "node:test";
import type { SavedRecipe } from "./saved-recipes";
import {
  SYNTHETIC_EXECUTION_ID_PREFIX,
  backfillOwnerSnippets,
  codemodeExecutionIdForRecipe,
  connectorsFromCapabilities,
  getSnippetDualRead,
  isSyntheticExecutionId,
  listSnippetsDualRead,
  projectSavedRecipe,
  syntheticExecutionId,
} from "./cm-snippets";
import type { Env } from "./types";

// In-memory D1 mock that supports the SELECT/INSERT/UPDATE patterns used by
// cm-snippets and saved-recipes. Built with the same shape as the existing
// pantry-sync test mock so behavior parity is straightforward to reason
// about.
type Row = Record<string, unknown>;

function makeEnv(): { env: Env; tables: { saved_recipes: SavedRecipe[]; cm_snippets: Row[] } } {
  const tables = { saved_recipes: [] as SavedRecipe[], cm_snippets: [] as Row[] };
  const db = {
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        async all<T = unknown>() {
          if (/FROM saved_recipes/.test(normalized) && /WHERE owner_email = \?/.test(normalized)) {
            const owner = String(bound[0]);
            let rows = tables.saved_recipes.filter((r) => r.owner_email === owner);
            if (/status = 'enabled'/.test(normalized)) rows = rows.filter((r) => r.status === "enabled");
            return { results: rows as unknown as T[] };
          }
          if (/FROM cm_snippets/.test(normalized) && /JOIN saved_recipes/.test(normalized)) {
            const owner = String(bound[0]);
            const rows = tables.cm_snippets.filter((snippet) => {
              const recipe = tables.saved_recipes.find((r) => r.owner_email === snippet.owner_email && r.id === snippet.source_recipe_id);
              return snippet.owner_email === owner && recipe?.status === "enabled";
            });
            return { results: rows as unknown as T[] };
          }
          if (/FROM cm_snippets/.test(normalized) && /WHERE owner_email = \?/.test(normalized)) {
            const owner = String(bound[0]);
            const rows = tables.cm_snippets.filter((r) => r.owner_email === owner);
            return { results: rows as unknown as T[] };
          }
          return { results: [] as T[] };
        },
        async first<T = unknown>() {
          if (/FROM cm_snippets/.test(normalized) && /WHERE owner_email = \? AND name = \?/.test(normalized)) {
            return (tables.cm_snippets.find((r) => r.owner_email === bound[0] && r.name === bound[1]) ?? null) as T;
          }
          if (/FROM cm_snippets/.test(normalized) && /WHERE owner_email = \? AND source_recipe_id = \?/.test(normalized)) {
            return (tables.cm_snippets.find((r) => r.owner_email === bound[0] && r.source_recipe_id === bound[1]) ?? null) as T;
          }
          if (/FROM saved_recipes/.test(normalized) && /WHERE id = \?/.test(normalized)) {
            return (tables.saved_recipes.find((r) => r.id === bound[0] && r.owner_email === bound[1]) ?? null) as T;
          }
          return null as T;
        },
        async run() {
          if (/^INSERT INTO cm_snippets/.test(normalized)) {
            const row: Row = {
              id: bound[0], owner_email: bound[1], name: bound[2], description: bound[3], code: bound[4],
              input_schema_json: bound[5], connectors_json: bound[6], saved_at: bound[7],
              source_recipe_id: bound[8], codemode_execution_id: bound[9],
              provenance: "projected", created_at: bound[10], updated_at: bound[11],
            };
            tables.cm_snippets.push(row);
            return { meta: { changes: 1 } };
          }
          if (/^UPDATE cm_snippets SET/.test(normalized)) {
            const id = bound[bound.length - 1];
            const row = tables.cm_snippets.find((r) => r.id === id);
            if (row) {
              row.description = bound[0];
              row.code = bound[1];
              row.input_schema_json = bound[2];
              row.connectors_json = bound[3];
              row.source_recipe_id = bound[4];
              row.updated_at = bound[5];
            }
            return { meta: { changes: row ? 1 : 0 } };
          }
          return { meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  };
  return { env: { DB: db } as unknown as Env, tables };
}

function makeRecipe(over: Partial<SavedRecipe> = {}): SavedRecipe {
  return {
    id: over.id ?? "r-1",
    owner_email: (over.owner_email ?? "owner@example.com").toLowerCase(),
    name: over.name ?? "demo_snippet",
    description: over.description ?? "demo snippet for tests",
    input_schema_json: over.input_schema_json ?? JSON.stringify({ type: "object", properties: { path: { type: "string" } } }),
    code: over.code ?? "return await workspace.read({ path: input.path });",
    capabilities_json: over.capabilities_json ?? JSON.stringify(["workspace.read"]),
    source_run_id: over.source_run_id ?? null,
    status: over.status ?? "enabled",
    created_at: over.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: over.updated_at ?? "2026-01-01T00:00:00.000Z",
  };
}

test("synthetic codemode execution ids are detectable and stable per recipe id", () => {
  const id = syntheticExecutionId("r-42");
  assert.equal(id, `${SYNTHETIC_EXECUTION_ID_PREFIX}r-42`);
  assert.ok(isSyntheticExecutionId(id));
  assert.ok(!isSyntheticExecutionId("cm_real_run_abc"));
  assert.ok(!isSyntheticExecutionId(undefined));
});

test("connectorsFromCapabilities derives sorted connector names from capability tags", () => {
  assert.deepEqual(connectorsFromCapabilities(["workspace.read", "machine.shell", "workspace.write"]), ["machine", "workspace"]);
  assert.deepEqual(connectorsFromCapabilities([]), []);
});

test("projectSavedRecipe inserts a row, then updates in place on a second call (idempotent)", async () => {
  const { env, tables } = makeEnv();
  const recipe = makeRecipe();
  tables.saved_recipes.push(recipe);
  const first = await projectSavedRecipe(env, recipe);
  assert.equal(tables.cm_snippets.length, 1);
  assert.equal(first.codemode_execution_id, syntheticExecutionId(recipe.id));
  assert.equal(first.provenance, "projected");
  // Update the recipe code and reproject — the row stays put, the
  // codemode_execution_id is preserved, but the body fields refresh.
  const updated = { ...recipe, description: "updated", code: "return 'changed';" };
  const second = await projectSavedRecipe(env, updated);
  assert.equal(tables.cm_snippets.length, 1, "no duplicate row on reproject");
  assert.equal(second.codemode_execution_id, first.codemode_execution_id, "execution id is stable");
  assert.equal(second.description, "updated");
  assert.equal(second.code, "return 'changed';");
});

test("backfillOwnerSnippets projects every enabled recipe and reports projected/refreshed counts", async () => {
  const { env, tables } = makeEnv();
  tables.saved_recipes.push(
    makeRecipe({ id: "r-1", name: "alpha" }),
    makeRecipe({ id: "r-2", name: "beta" }),
    makeRecipe({ id: "r-3", name: "disabled_one", status: "disabled" }),
  );
  const first = await backfillOwnerSnippets(env, "owner@example.com");
  assert.equal(first.projected, 2, "two enabled rows projected");
  assert.equal(first.refreshed, 0);
  // Disabled rows never project.
  assert.equal(tables.cm_snippets.length, 2);
  // Re-run is idempotent: same rows now report as refreshed, not projected.
  const second = await backfillOwnerSnippets(env, "owner@example.com");
  assert.equal(second.projected, 0);
  assert.equal(second.refreshed, 2);
  assert.equal(tables.cm_snippets.length, 2);
});

test("listSnippetsDualRead reads cm_snippets first and falls back to saved_recipes when empty", async () => {
  const { env, tables } = makeEnv();
  const recipe = makeRecipe({ id: "r-7", name: "search_blog" });
  tables.saved_recipes.push(recipe);
  // No cm_snippets row yet — dual-read derives a transient projection.
  const transient = await listSnippetsDualRead(env, "owner@example.com");
  assert.equal(transient.length, 1);
  assert.equal(transient[0].name, "search_blog");
  assert.equal(transient[0].provenance, "projected");
  assert.equal(transient[0].codemodeExecutionId, syntheticExecutionId("r-7"));
  assert.ok(transient[0].id.startsWith("transient_"));
  // After backfill the dual-read serves the projection row directly.
  await backfillOwnerSnippets(env, "owner@example.com");
  const persisted = await listSnippetsDualRead(env, "owner@example.com");
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].name, "search_blog");
  assert.equal(persisted[0].codemodeExecutionId, syntheticExecutionId("r-7"));
  assert.ok(!persisted[0].id.startsWith("transient_"), "served from cm_snippets row, not in-memory transient");
});

test("listSnippetsDualRead does not advertise stale disabled projections", async () => {
  const { env, tables } = makeEnv();
  const recipe = makeRecipe({ id: "r-disabled", name: "stale_disabled", status: "enabled" });
  tables.saved_recipes.push(recipe);
  await projectSavedRecipe(env, recipe);
  tables.saved_recipes[0] = { ...recipe, status: "disabled" };
  const snippets = await listSnippetsDualRead(env, "owner@example.com");
  assert.equal(snippets.some((snippet) => snippet.name === "stale_disabled"), false);
  assert.equal(await getSnippetDualRead(env, "owner@example.com", "stale_disabled"), null);
});

test("getSnippetDualRead looks up a single snippet by name through the same seam", async () => {
  const { env, tables } = makeEnv();
  tables.saved_recipes.push(makeRecipe({ id: "r-9", name: "lookup_me" }));
  const found = await getSnippetDualRead(env, "owner@example.com", "lookup_me");
  assert.ok(found);
  assert.equal(found!.name, "lookup_me");
  const missing = await getSnippetDualRead(env, "owner@example.com", "nope");
  assert.equal(missing, null);
});

test("codemodeExecutionIdForRecipe returns the projection id when present and a synthetic id otherwise", async () => {
  const { env, tables } = makeEnv();
  const recipe = makeRecipe({ id: "r-77", name: "exec_id_test" });
  tables.saved_recipes.push(recipe);
  // No projection yet — synthetic id is returned so receipts always carry a value.
  const synthetic = await codemodeExecutionIdForRecipe(env, recipe);
  assert.equal(synthetic, syntheticExecutionId("r-77"));
  await projectSavedRecipe(env, recipe);
  // After projection the same id is served from the row (still synthetic
  // since no native run has promoted it).
  const projected = await codemodeExecutionIdForRecipe(env, recipe);
  assert.equal(projected, syntheticExecutionId("r-77"));
});
