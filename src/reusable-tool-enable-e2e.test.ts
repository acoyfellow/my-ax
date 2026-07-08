import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "./types";
import type { SavedRecipe } from "./saved-recipes";
import { SavedRecipeService } from "./saved-recipes";
import { projectSavedRecipe, listSnippetsDualRead } from "./cm-snippets";

// End-to-end coverage for the reusable-tool enablement flow that the dogfood
// bug hit. It exercises the REAL SavedRecipeService + projection + dual-read
// paths against an in-memory D1 mock, reproducing exactly what the
// /api/recipes/by-name/approval route does on Enable:
//   getByName -> update(status:"enabled") -> projectSavedRecipe
// then verifies codemode visibility (search/describe via listSnippetsDualRead)
// and the run-name resolution (list filtered to enabled+name).

type Row = Record<string, unknown>;

function makeEnv() {
  const tables = { saved_recipes: [] as SavedRecipe[], cm_snippets: [] as Row[] };
  const db = {
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, " ").trim();
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        async all<T = unknown>() {
          if (/FROM saved_recipes WHERE owner_email = \?/.test(q)) {
            const owner = String(bound[0]);
            let rows = tables.saved_recipes.filter((r) => r.owner_email === owner);
            if (/status = 'enabled'/.test(q)) rows = rows.filter((r) => r.status === "enabled");
            return { results: rows as unknown as T[] };
          }
          if (/FROM cm_snippets c JOIN saved_recipes/.test(q) || (/FROM cm_snippets/.test(q) && /JOIN saved_recipes/.test(q))) {
            const owner = String(bound[0]);
            const rows = tables.cm_snippets.filter((s) => {
              const recipe = tables.saved_recipes.find((r) => r.owner_email === s.owner_email && r.id === s.source_recipe_id);
              return s.owner_email === owner && recipe?.status === "enabled";
            });
            return { results: rows as unknown as T[] };
          }
          if (/FROM cm_snippets WHERE owner_email = \?/.test(q)) {
            const owner = String(bound[0]);
            return { results: tables.cm_snippets.filter((r) => r.owner_email === owner) as unknown as T[] };
          }
          return { results: [] as T[] };
        },
        async first<T = unknown>() {
          if (/FROM saved_recipes WHERE name = \? AND owner_email = \?/.test(q)) {
            return (tables.saved_recipes.find((r) => r.name === bound[0] && r.owner_email === bound[1]) ?? null) as T;
          }
          if (/FROM saved_recipes WHERE id = \? AND owner_email = \?/.test(q)) {
            return (tables.saved_recipes.find((r) => r.id === bound[0] && r.owner_email === bound[1]) ?? null) as T;
          }
          if (/FROM cm_snippets WHERE owner_email = \? AND name = \?/.test(q)) {
            return (tables.cm_snippets.find((r) => r.owner_email === bound[0] && r.name === bound[1]) ?? null) as T;
          }
          if (/FROM cm_snippets WHERE owner_email = \? AND source_recipe_id = \?/.test(q)) {
            return (tables.cm_snippets.find((r) => r.owner_email === bound[0] && r.source_recipe_id === bound[1]) ?? null) as T;
          }
          return null as T;
        },
        async run() {
          if (/^INSERT INTO saved_recipes/.test(q)) {
            tables.saved_recipes.push({
              id: bound[0], owner_email: bound[1], name: bound[2], description: bound[3],
              input_schema_json: bound[4], code: bound[5], capabilities_json: bound[6],
              source_run_id: bound[7], status: bound[8], created_at: bound[9], updated_at: bound[10],
            } as unknown as SavedRecipe);
            return { meta: { changes: 1 } };
          }
          if (/^UPDATE saved_recipes SET/.test(q)) {
            const id = bound[bound.length - 2];
            const owner = bound[bound.length - 1];
            const row = tables.saved_recipes.find((r) => r.id === id && r.owner_email === owner);
            if (row && /status = \?/.test(q)) {
              // status is the only assignment in the approval update path.
              row.status = bound[0] as SavedRecipe["status"];
              row.updated_at = String(bound[1]);
            }
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (/^INSERT INTO cm_snippets/.test(q)) {
            tables.cm_snippets.push({
              id: bound[0], owner_email: bound[1], name: bound[2], description: bound[3], code: bound[4],
              input_schema_json: bound[5], connectors_json: bound[6], saved_at: bound[7],
              source_recipe_id: bound[8], codemode_execution_id: bound[9], provenance: "projected",
              created_at: bound[10], updated_at: bound[11],
            });
            return { meta: { changes: 1 } };
          }
          if (/^UPDATE cm_snippets SET/.test(q)) {
            const id = bound[bound.length - 1];
            const row = tables.cm_snippets.find((r) => r.id === id);
            if (row) { row.description = bound[0]; row.code = bound[1]; row.input_schema_json = bound[2]; row.connectors_json = bound[3]; row.source_recipe_id = bound[4]; row.updated_at = bound[5]; }
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

const OWNER = "owner@example.com";
const NAME = "disk_health_check";
const SOURCE = "// reusable-tool: disk health check\nasync (ctx) => ({ ok: true, files: await ctx.workspace.list({ path: '/home/user' }) })";

test("enable an eligible review candidate: pending -> enabled -> visible to codemode -> resolvable by run", async () => {
  const { env } = makeEnv();
  const service = new SavedRecipeService(env, OWNER);

  // Promotion in review mode persists the candidate as pending.
  const created = await service.create({
    name: NAME,
    description: "Report disk health for the workspace.",
    inputSchema: { type: "object", properties: {} },
    code: SOURCE,
    capabilities: ["workspace.list"],
    status: "pending",
  });
  assert.equal(created.status, "pending");

  // Before enable: NOT visible to codemode, NOT runnable by name.
  const beforeSnippets = await listSnippetsDualRead(env, OWNER);
  assert.equal(beforeSnippets.some((s) => s.name === NAME), false, "pending recipe must not be visible to codemode");
  const beforeRunnable = (await service.list()).filter((r) => r.status === "enabled" && r.name === NAME);
  assert.equal(beforeRunnable.length, 0, "pending recipe must not be resolvable by run");

  // The exact by-name/approval Enable sequence: getByName -> verify code ->
  // update(enabled) -> projectSavedRecipe.
  const existing = await service.getByName(NAME);
  assert.equal(existing.code.trim(), SOURCE.trim(), "card source must match the saved row");
  const enabled = await service.update(existing.id, { status: "enabled" });
  assert.equal(enabled.status, "enabled", "approval flips the row to enabled");
  await projectSavedRecipe(env, await service.get(existing.id));

  // After enable: search/describe resolve (dual-read returns it) and run
  // resolves by name.
  const afterSnippets = await listSnippetsDualRead(env, OWNER);
  const projected = afterSnippets.find((s) => s.name === NAME);
  assert.ok(projected, "enabled recipe must be visible to codemode search/describe");
  assert.equal(projected!.description, "Report disk health for the workspace.");
  const runnable = (await service.list()).filter((r) => r.status === "enabled" && r.name === NAME);
  assert.equal(runnable.length, 1, "run must resolve exactly one enabled recipe by name");
  assert.equal(runnable[0].id, existing.id);
});

test("getByName still resolves a pending row so approval can flip it (no false NotFound)", async () => {
  const { env } = makeEnv();
  const service = new SavedRecipeService(env, OWNER);
  await service.create({ name: NAME, description: "Report disk health for the workspace.", inputSchema: { type: "object", properties: {} }, code: SOURCE, capabilities: ["workspace.list"], status: "pending" });
  const found = await service.getByName(NAME);
  assert.equal(found.name, NAME);
  assert.equal(found.status, "pending");
});
