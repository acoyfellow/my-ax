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
  const inputJson = JSON.stringify(input);
  if (/^(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(trimmed)) {
    return `async () => { const input = ${inputJson}; return await (${trimmed})(input); }`;
  }
  return `async () => { const input = ${inputJson};\n${recipeCode}\n}`;
}

const CAPABILITY_PATTERN = /^(workspace|machine|cloudbox)\.[a-zA-Z0-9_.-]+$/;

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
  const status = body.status === "pending" ? "pending" : body.status === "disabled" ? "disabled" : "enabled";
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

export function validateSavedRecipePatch(input: unknown): Partial<SavedRecipeInput> {
  const body = assertObject(input, "recipe");
  const patch: Partial<SavedRecipeInput> = {};
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
    patch.status = body.status;
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
    return results.map(publicRecipe);
  }

  async get(id: string): Promise<SavedRecipe> {
    const row = await this.env.DB.prepare("SELECT * FROM saved_recipes WHERE id = ? AND owner_email = ?").bind(id, this.owner()).first<SavedRecipe>();
    if (!row) throw new SavedRecipeError("NotFound", "saved recipe not found");
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
      await this.env.DB.prepare(`INSERT INTO saved_recipes (id, owner_email, name, description, input_schema_json, code, capabilities_json, source_run_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.owner_email, row.name, row.description, row.input_schema_json, row.code, row.capabilities_json, row.source_run_id, row.status, row.created_at, row.updated_at).run();
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new SavedRecipeError("Conflict", "saved recipe name already exists");
      throw error;
    }
    return publicRecipe(row);
  }

  async update(id: string, input: unknown) {
    await this.get(id);
    const patch = validateSavedRecipePatch(input);
    const assignments: string[] = [];
    const values: unknown[] = [];
    if (patch.name !== undefined) { assignments.push("name = ?"); values.push(patch.name); }
    if (patch.description !== undefined) { assignments.push("description = ?"); values.push(patch.description); }
    if (patch.inputSchema !== undefined) { assignments.push("input_schema_json = ?"); values.push(JSON.stringify(patch.inputSchema)); }
    if (patch.code !== undefined) { assignments.push("code = ?"); values.push(patch.code); }
    if (patch.capabilities !== undefined) { assignments.push("capabilities_json = ?"); values.push(JSON.stringify(patch.capabilities)); }
    if (patch.status !== undefined) { assignments.push("status = ?"); values.push(patch.status); }
    if (patch.sourceRunId !== undefined) { assignments.push("source_run_id = ?"); values.push(patch.sourceRunId); }
    assignments.push("updated_at = ?"); values.push(new Date().toISOString());
    try {
      await this.env.DB.prepare(`UPDATE saved_recipes SET ${assignments.join(", ")} WHERE id = ? AND owner_email = ?`).bind(...values, id, this.owner()).run();
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new SavedRecipeError("Conflict", "saved recipe name already exists");
      throw error;
    }
    return publicRecipe(await this.get(id));
  }

  async delete(id: string) {
    const result = await this.env.DB.prepare("DELETE FROM saved_recipes WHERE id = ? AND owner_email = ?").bind(id, this.owner()).run();
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
