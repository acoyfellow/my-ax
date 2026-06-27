import type { Env } from "./types";

export const SAVED_HAMMER_STATUSES = ["enabled", "disabled"] as const;
export type SavedHammerStatus = (typeof SAVED_HAMMER_STATUSES)[number];

export type SavedHammer = {
  id: string;
  owner_email: string;
  name: string;
  description: string;
  input_schema_json: string;
  code: string;
  capabilities_json: string;
  source_run_id: string | null;
  status: SavedHammerStatus;
  created_at: string;
  updated_at: string;
};

export type SavedHammerInput = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  code: string;
  capabilities: string[];
  sourceRunId?: string | null;
  status?: SavedHammerStatus;
};

export class SavedHammerError extends Error {
  constructor(public code: "InvalidInput" | "NotFound" | "Conflict", message: string) {
    super(message);
    this.name = "SavedHammerError";
  }
}

const CAPABILITY_PATTERN = /^(workspace|machine|cloudbox)\.[a-zA-Z0-9_.-]+$/;

function assertObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SavedHammerError("InvalidInput", `${field} must be an object`);
  return value as Record<string, unknown>;
}

function cleanName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)) throw new SavedHammerError("InvalidInput", "name must match /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/");
  return name;
}

export function validateSavedHammerInput(input: unknown): SavedHammerInput {
  const body = assertObject(input, "hammer");
  const name = cleanName(body.name);
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length < 5 || description.length > 500) throw new SavedHammerError("InvalidInput", "description must be 5-500 characters");
  const inputSchema = assertObject(body.inputSchema ?? { type: "object", properties: {} }, "inputSchema");
  if (inputSchema.type !== "object") throw new SavedHammerError("InvalidInput", "inputSchema.type must be object");
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) throw new SavedHammerError("InvalidInput", "code is required");
  if (new TextEncoder().encode(code).byteLength > 32_000) throw new SavedHammerError("InvalidInput", "code must be <= 32000 bytes");
  const capabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
  if (!capabilities.length) throw new SavedHammerError("InvalidInput", "capabilities must list at least one granted capability");
  const cleanCapabilities = capabilities.map((capability) => typeof capability === "string" ? capability.trim() : "");
  const invalid = cleanCapabilities.filter((capability) => !CAPABILITY_PATTERN.test(capability));
  if (invalid.length) throw new SavedHammerError("InvalidInput", `invalid capabilities: ${invalid.join(", ")}`);
  const status = body.status === "disabled" ? "disabled" : "enabled";
  const sourceRunId = typeof body.sourceRunId === "string" && body.sourceRunId.trim() ? body.sourceRunId.trim() : null;
  return { name, description, inputSchema, code, capabilities: [...new Set(cleanCapabilities)].sort(), sourceRunId, status };
}

export function publicHammer(row: SavedHammer) {
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

export class SavedHammerService {
  constructor(private env: Env, private ownerEmail: string) {}
  private owner() { return this.ownerEmail.toLowerCase(); }

  async list() {
    const { results = [] } = await this.env.DB.prepare("SELECT * FROM saved_hammers WHERE owner_email = ? ORDER BY updated_at DESC").bind(this.owner()).all<SavedHammer>();
    return results.map(publicHammer);
  }

  async get(id: string): Promise<SavedHammer> {
    const row = await this.env.DB.prepare("SELECT * FROM saved_hammers WHERE id = ? AND owner_email = ?").bind(id, this.owner()).first<SavedHammer>();
    if (!row) throw new SavedHammerError("NotFound", "saved hammer not found");
    return row;
  }

  async create(input: unknown) {
    const parsed = validateSavedHammerInput(input);
    const row: SavedHammer = {
      id: crypto.randomUUID(),
      owner_email: this.owner(),
      name: parsed.name,
      description: parsed.description,
      input_schema_json: JSON.stringify(parsed.inputSchema),
      code: parsed.code,
      capabilities_json: JSON.stringify(parsed.capabilities),
      source_run_id: parsed.sourceRunId ?? null,
      status: parsed.status ?? "enabled",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    try {
      await this.env.DB.prepare(`INSERT INTO saved_hammers (id, owner_email, name, description, input_schema_json, code, capabilities_json, source_run_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.owner_email, row.name, row.description, row.input_schema_json, row.code, row.capabilities_json, row.source_run_id, row.status, row.created_at, row.updated_at).run();
    } catch (error) {
      if (String(error).includes("UNIQUE")) throw new SavedHammerError("Conflict", "saved hammer name already exists");
      throw error;
    }
    return publicHammer(row);
  }

  async requireEnabled(id: string) {
    const row = await this.get(id);
    if (row.status !== "enabled") throw new SavedHammerError("InvalidInput", "saved hammer is disabled");
    return row;
  }
}

export function hammerRunTitle(row: Pick<SavedHammer, "name">) {
  return `Hammer: ${row.name}`;
}
