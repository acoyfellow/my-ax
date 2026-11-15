import { initialRecipeStatus, nextRecipeStatus, patchStatusEvent, requireRecipeTransition, type RecipeStatusEvent } from "./fsm/recipe-status";
import { safely, shadowRecipe } from "./domain/shadow";
import { deleteRecipeRecord, saveRecipeRecord, updateRecipeRecord, type RecipeFieldChange } from "./domain/Recipe/Recipe.store";
import type { Env } from "./types";

export const SAVED_RECIPE_STATUSES = ["pending", "enabled", "disabled"] as const;
export type SavedRecipeStatus = (typeof SAVED_RECIPE_STATUSES)[number];

export type SavedRecipe = {
  id: string;
  owner_email: string;
  name: string;
  description: string;
  input_schema_json: string;
  code: string;
  capabilities_json: string;
  source_run_id: string | null;
  status: SavedRecipeStatus;
  created_at: string;
  updated_at: string;
};

export type SavedRecipeInput = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  code: string;
  capabilities: string[];
  sourceRunId?: string | null;
  status?: SavedRecipeStatus;
};

export class SavedRecipeError extends Error {
  constructor(public code: "InvalidInput" | "NotFound" | "Conflict", message: string) {
    super(message);
    this.name = "SavedRecipeError";
  }
}

export function savedRecipeExecutionCode(recipeCode: string, input: Record<string, unknown>): string {
  const trimmed = recipeCode.trim().replace(/;+$/, "");
  // Candidate metadata is an auditable source comment, not part of the arrow
  // expression. Remove only that first-line marker before detecting/wrapping
  // a saved async arrow; legacy body-style recipes remain unchanged.
  const executable = trimmed
    .replace(/^[\uFEFF \t]*\/\/[ \t]*reusable-tool[ \t]*:[^\r\n]*(?:\r?\n|$)/, "")
    .trimStart();
  const inputJson = JSON.stringify(input);
  if (/^(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(executable)) {
    return `async () => { const input = ${inputJson}; return await (${executable})(input); }`;
  }
  return `async () => { const input = ${inputJson};\n${recipeCode}\n}`;
}

const CAPABILITY_PATTERN = /^(workspace|machine)\.[a-zA-Z0-9_.-]+$/;

const RETIRED_CAPABILITY_PATTERN = /^(computer|terrarium|agentcast)\./;

export function hasRetiredRecipeCapability(capabilities: string[]): boolean {
  return capabilities.some((capability) => RETIRED_CAPABILITY_PATTERN.test(capability));
}

function assertObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SavedRecipeError("InvalidInput", `${field} must be an object`);
  return value as Record<string, unknown>;
}

function cleanName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)) throw new SavedRecipeError("InvalidInput", "name must match /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/");
  return name;
}

export function validateSavedRecipeInput(input: unknown): SavedRecipeInput {
  const body = assertObject(input, "recipe");
  const name = cleanName(body.name);
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length < 5 || description.length > 500) throw new SavedRecipeError("InvalidInput", "description must be 5-500 characters");
  const inputSchema = assertObject(body.inputSchema ?? { type: "object", properties: {} }, "inputSchema");
  if (inputSchema.type !== "object") throw new SavedRecipeError("InvalidInput", "inputSchema.type must be object");
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) throw new SavedRecipeError("InvalidInput", "code is required");
  if (new TextEncoder().encode(code).byteLength > 32_000) throw new SavedRecipeError("InvalidInput", "code must be <= 32000 bytes");
  const capabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
  if (!capabilities.length) throw new SavedRecipeError("InvalidInput", "capabilities must list at least one granted capability");
  const cleanCapabilities = capabilities.map((capability) => typeof capability === "string" ? capability.trim() : "");
  const invalid = cleanCapabilities.filter((capability) => !CAPABILITY_PATTERN.test(capability));
  if (invalid.length) throw new SavedRecipeError("InvalidInput", `invalid capabilities: ${invalid.join(", ")}`);
  // Creation is owner-gated by default. Existing explicit auto-trust/native
  // callers may still request enabled, but omitted or unknown status can never
  // make unreviewed code runnable.
  const status = initialRecipeStatus(body.status);
  const sourceRunId = typeof body.sourceRunId === "string" && body.sourceRunId.trim() ? body.sourceRunId.trim() : null;
  return { name, description, inputSchema, code, capabilities: [...new Set(cleanCapabilities)].sort(), sourceRunId, status };
}

export function publicRecipe(row: SavedRecipe) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    inputSchema: JSON.parse(row.input_schema_json),
    capabilities: JSON.parse(row.capabilities_json),
    sourceRunId: row.source_run_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function jsonType(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validateSchemaValue(path: string, value: unknown, schema: Record<string, unknown>) {
  const type = schema.type;
  if (typeof type === "string" && jsonType(value) !== type) throw new SavedRecipeError("InvalidInput", `${path} must be ${type}`);
  if (Array.isArray(type) && !type.includes(jsonType(value))) throw new SavedRecipeError("InvalidInput", `${path} must be one of ${type.join(", ")}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) throw new SavedRecipeError("InvalidInput", `${path} must match an allowed value`);
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) throw new SavedRecipeError("InvalidInput", `${path} is shorter than ${schema.minLength}`);
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) throw new SavedRecipeError("InvalidInput", `${path} is longer than ${schema.maxLength}`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) throw new SavedRecipeError("InvalidInput", `${path} must be >= ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) throw new SavedRecipeError("InvalidInput", `${path} must be <= ${schema.maximum}`);
  }
}

export function validateRecipeRunInput(input: unknown, inputSchema: unknown): Record<string, unknown> {
  const body = assertObject(input ?? {}, "input");
  const schema = assertObject(inputSchema ?? { type: "object", properties: {} }, "inputSchema");
  if (schema.type !== "object") throw new SavedRecipeError("InvalidInput", "inputSchema.type must be object");
  const properties = schema.properties === undefined ? {} : assertObject(schema.properties, "inputSchema.properties");
  const required = Array.isArray(schema.required) ? schema.required.filter((field): field is string => typeof field === "string") : [];
  for (const field of required) {
    if (!(field in body)) throw new SavedRecipeError("InvalidInput", `input.${field} is required`);
  }
  for (const [field, propertySchema] of Object.entries(properties)) {
    if (!(field in body)) continue;
    validateSchemaValue(`input.${field}`, body[field], assertObject(propertySchema, `inputSchema.properties.${field}`));
  }
  return body;
}

export type SavedRecipePatch = Partial<Omit<SavedRecipeInput, "status">> & { statusEvent?: RecipeStatusEvent };

export function validateSavedRecipePatch(input: unknown): SavedRecipePatch {
  const body = assertObject(input, "recipe");
  const patch: SavedRecipePatch = {};
  if ("name" in body) patch.name = cleanName(body.name);
  if ("description" in body) {
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (description.length < 5 || description.length > 500) throw new SavedRecipeError("InvalidInput", "description must be 5-500 characters");
    patch.description = description;
  }
  if ("inputSchema" in body) {
    const inputSchema = assertObject(body.inputSchema, "inputSchema");
    if (inputSchema.type !== "object") throw new SavedRecipeError("InvalidInput", "inputSchema.type must be object");
    patch.inputSchema = inputSchema;
  }
  if ("code" in body) {
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) throw new SavedRecipeError("InvalidInput", "code is required");
    if (new TextEncoder().encode(code).byteLength > 32_000) throw new SavedRecipeError("InvalidInput", "code must be <= 32000 bytes");
    patch.code = code;
  }
  if ("capabilities" in body) {
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
    if (!capabilities.length) throw new SavedRecipeError("InvalidInput", "capabilities must list at least one granted capability");
    const cleanCapabilities = capabilities.map((capability) => typeof capability === "string" ? capability.trim() : "");
    const invalid = cleanCapabilities.filter((capability) => !CAPABILITY_PATTERN.test(capability));
    if (invalid.length) throw new SavedRecipeError("InvalidInput", `invalid capabilities: ${invalid.join(", ")}`);
    patch.capabilities = [...new Set(cleanCapabilities)].sort();
  }
  if ("status" in body) {
    if (body.status !== "pending" && body.status !== "enabled" && body.status !== "disabled") throw new SavedRecipeError("InvalidInput", "status must be pending, enabled, or disabled");
    patch.statusEvent = patchStatusEvent(body.status);
  }
  if ("sourceRunId" in body) patch.sourceRunId = typeof body.sourceRunId === "string" && body.sourceRunId.trim() ? body.sourceRunId.trim() : null;
  if (!Object.keys(patch).length) throw new SavedRecipeError("InvalidInput", "at least one field is required");
  return patch;
}

export class SavedRecipeService {
  constructor(private env: Env, private ownerEmail: string) {}
  private owner() { return this.ownerEmail.toLowerCase(); }

  async list() {
    const { results = [] } = await this.env.DB.prepare("SELECT * FROM saved_recipes WHERE owner_email = ? ORDER BY updated_at DESC").bind(this.owner()).all<SavedRecipe>();
    return results.map(publicRecipe).filter((recipe) => !hasRetiredRecipeCapability(recipe.capabilities));
  }

  async get(id: string): Promise<SavedRecipe> {
    const row = await this.env.DB.prepare("SELECT * FROM saved_recipes WHERE id = ? AND owner_email = ?").bind(id, this.owner()).first<SavedRecipe>();
    if (!row) throw new SavedRecipeError("NotFound", "saved recipe not found");
    return row;
  }

  async getByName(name: string): Promise<SavedRecipe> {
    const clean = cleanName(name);
    const row = await this.env.DB.prepare("SELECT * FROM saved_recipes WHERE name = ? AND owner_email = ?").bind(clean, this.owner()).first<SavedRecipe>();
    if (!row) throw new SavedRecipeError("NotFound", "reusable tool not found");
    return row;
  }

  async create(input: unknown) {
    const parsed = validateSavedRecipeInput(input);
    const row: SavedRecipe = {
      id: crypto.randomUUID(),
      owner_email: this.owner(),
      name: parsed.name,
      description: parsed.description,
      input_schema_json: JSON.stringify(parsed.inputSchema),
      code: parsed.code,
      capabilities_json: JSON.stringify(parsed.capabilities),
      source_run_id: parsed.sourceRunId ?? null,
      status: parsed.status ?? "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    try {
      await saveRecipeRecord(this.env.DB, row);
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new SavedRecipeError("Conflict", "saved recipe name already exists");
      throw error;
    }
    return publicRecipe(row);
  }

  async update(id: string, input: unknown) {
    return this.applyPatch(id, validateSavedRecipePatch(input));
  }

  async transition(id: string, event: "approved" | "rejected") {
    return this.applyPatch(id, { statusEvent: event });
  }

  private async applyPatch(id: string, patch: SavedRecipePatch) {
    const current = await this.get(id);
    const statusEvent = patch.statusEvent;
    if (statusEvent) safely(() => shadowRecipe(statusEvent, this.owner(), current.status, nextRecipeStatus(current.status, statusEvent) ? "accepted" : "rejected"));
    const nextStatus = statusEvent ? requireRecipeTransition(current.status, statusEvent) : undefined;
    const changes: RecipeFieldChange[] = [];
    if (patch.name !== undefined) changes.push({ column: "name", value: patch.name });
    if (patch.description !== undefined) changes.push({ column: "description", value: patch.description });
    if (patch.inputSchema !== undefined) changes.push({ column: "input_schema_json", value: JSON.stringify(patch.inputSchema) });
    if (patch.code !== undefined) changes.push({ column: "code", value: patch.code });
    if (patch.capabilities !== undefined) changes.push({ column: "capabilities_json", value: JSON.stringify(patch.capabilities) });
    if (nextStatus !== undefined) changes.push({ column: "status", value: nextStatus });
    if (patch.sourceRunId !== undefined) changes.push({ column: "source_run_id", value: patch.sourceRunId });
    try {
      const result = await updateRecipeRecord(this.env.DB, { id, owner_email: this.owner(), status: current.status }, statusEvent, changes, new Date().toISOString());
      if ((result.meta?.changes ?? 0) === 0) throw new SavedRecipeError("Conflict", "saved recipe changed during the update");
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new SavedRecipeError("Conflict", "saved recipe name already exists");
      throw error;
    }
    return publicRecipe(await this.get(id));
  }

  async delete(id: string) {
    const current = await this.get(id).catch(() => null);
    const result = await deleteRecipeRecord(this.env.DB, current, id, this.owner());
    if ((result.meta?.changes ?? 0) === 0) throw new SavedRecipeError("NotFound", "saved recipe not found");
    return { deleted: true, id };
  }

  async requireEnabled(id: string) {
    const row = await this.get(id);
    if (row.status !== "enabled") throw new SavedRecipeError("InvalidInput", `saved recipe is ${row.status}`);
    return row;
  }
}

export function recipeRunTitle(row: Pick<SavedRecipe, "name">) {
  return `Recipe: ${row.name}`;
}
