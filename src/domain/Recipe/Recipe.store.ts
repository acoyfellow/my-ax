import { decide } from "../decide";
import { RECIPE_COMMAND_FOR_EVENT } from "../shadow";
import * as Commands from "./commands";
import { DeleteRecipe } from "./DeleteRecipe.command";
import { EditRecipe } from "./EditRecipe.command";
import { Recipe, type RecipeStage } from "./Recipe.aggregate";
import { SaveRecipe } from "./SaveRecipe.command";

type Statement = { run(): Promise<unknown> };
export type RecipeStoreDb = { prepare(sql: string): { bind(...values: unknown[]): Statement } };
export type RecipeWriteResult = { meta?: { changes?: number } };

export type RecipeRow = {
  id: string;
  owner_email: string;
  name: string;
  description: string;
  input_schema_json: string;
  code: string;
  capabilities_json: string;
  source_run_id: string | null;
  status: "pending" | "enabled" | "disabled";
  created_at: string;
  updated_at: string;
};

export type RecipeFieldChange = { column: "name" | "description" | "input_schema_json" | "code" | "capabilities_json" | "source_run_id" | "status"; value: unknown };

const stageOf = (status: string): RecipeStage => (status.charAt(0).toUpperCase() + status.slice(1)) as RecipeStage;
const present = (owner: string, status: string) => ({ _tag: "Present" as const, ownerEmail: owner, stage: stageOf(status) });

const INSERT_RECIPE_SQL = `INSERT INTO saved_recipes (id, owner_email, name, description, input_schema_json, code, capabilities_json, source_run_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const DELETE_RECIPE_SQL = "DELETE FROM saved_recipes WHERE id = ? AND owner_email = ?";

export async function saveRecipeRecord(db: RecipeStoreDb, row: RecipeRow): Promise<void> {
  decide(Recipe, row.id, { _tag: "Missing" }, new SaveRecipe({ ownerEmail: row.owner_email, stage: stageOf(row.status) }));
  await db.prepare(INSERT_RECIPE_SQL).bind(row.id, row.owner_email, row.name, row.description, row.input_schema_json, row.code, row.capabilities_json, row.source_run_id, row.status, row.created_at, row.updated_at).run();
}

export async function updateRecipeRecord(
  db: RecipeStoreDb,
  current: Pick<RecipeRow, "id" | "owner_email" | "status">,
  statusEvent: string | undefined,
  changes: readonly RecipeFieldChange[],
  updatedAt: string,
): Promise<RecipeWriteResult> {
  const command = statusEvent ? new Commands.ALL[RECIPE_COMMAND_FOR_EVENT[statusEvent]]() : new EditRecipe();
  decide(Recipe, current.id, present(current.owner_email, current.status), command as { readonly _tag: string });
  const assignments = [...changes.map((change) => `${change.column} = ?`), "updated_at = ?"];
  const values = [...changes.map((change) => change.value), updatedAt];
  return (await db
    .prepare(`UPDATE saved_recipes SET ${assignments.join(", ")} WHERE id = ? AND owner_email = ? AND status = ?`)
    .bind(...values, current.id, current.owner_email, current.status)
    .run()) as RecipeWriteResult;
}

export async function deleteRecipeRecord(db: RecipeStoreDb, current: Pick<RecipeRow, "id" | "owner_email" | "status"> | null, id: string, owner: string): Promise<RecipeWriteResult> {
  if (current) decide(Recipe, id, present(owner, current.status), new DeleteRecipe());
  return (await db.prepare(DELETE_RECIPE_SQL).bind(id, owner).run()) as RecipeWriteResult;
}
