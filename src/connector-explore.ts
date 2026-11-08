export type ExploredTool = { serverId: string; name: string; description: string; inputSchema: unknown };

export type ExploredResource = { serverId: string; uri: string; name: string; description: string; mimeType: string | null };

export type ExploredPromptArgument = { name: string; description: string; required: boolean };

export type ExploredPrompt = { serverId: string; name: string; description: string; arguments: ExploredPromptArgument[] };

export type ExploredServer = { id: string; serverId: string; state: string; error: string | null };

export type ConnectorExploreResult = {
  servers: ExploredServer[];
  tools: Record<string, ExploredTool[]>;
  resources: Record<string, ExploredResource[]>;
  prompts: Record<string, ExploredPrompt[]>;
  serverIdByName: Record<string, string>;
};

export const EMPTY_EXPLORE: ConnectorExploreResult = { servers: [], tools: {}, resources: {}, prompts: {}, serverIdByName: {} };

export type SchemaField = { name: string; type: "string" | "number" | "integer" | "boolean" | "json"; required: boolean; description: string; enumValues: string[] | null };

type JsonSchemaProperty = { type?: string | string[]; description?: string; enum?: unknown[] };

type JsonObjectSchema = { properties?: Record<string, JsonSchemaProperty>; required?: string[] };

function fieldType(property: JsonSchemaProperty): SchemaField["type"] {
  const declared = Array.isArray(property.type) ? property.type.find((candidate) => candidate !== "null") : property.type;
  if (declared === "string" || declared === "number" || declared === "integer" || declared === "boolean") return declared;
  return "json";
}

export function schemaFields(schema: unknown): SchemaField[] {
  if (!schema || typeof schema !== "object") return [];
  const objectSchema = schema as JsonObjectSchema;
  const required = new Set(Array.isArray(objectSchema.required) ? objectSchema.required : []);
  return Object.entries(objectSchema.properties ?? {}).map(([name, property]) => ({
    name,
    type: fieldType(property ?? {}),
    required: required.has(name),
    description: typeof property?.description === "string" ? property.description : "",
    enumValues: Array.isArray(property?.enum) ? property.enum.map(String) : null,
  }));
}

export type FieldParse = { ok: true; args: Record<string, unknown> } | { ok: false; field: string; error: string };

export function argsFromFields(fields: SchemaField[], values: Record<string, string>): FieldParse {
  const args: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = (values[field.name] ?? "").trim();
    if (!raw) {
      if (field.required) return { ok: false, field: field.name, error: `${field.name} is required` };
      continue;
    }
    if (field.type === "string") args[field.name] = raw;
    else if (field.type === "boolean") args[field.name] = raw === "true";
    else if (field.type === "number" || field.type === "integer") {
      const value = Number(raw);
      if (!Number.isFinite(value) || (field.type === "integer" && !Number.isInteger(value))) return { ok: false, field: field.name, error: `${field.name} must be ${field.type === "integer" ? "a whole number" : "a number"}` };
      args[field.name] = value;
    } else {
      try {
        args[field.name] = JSON.parse(raw);
      } catch {
        return { ok: false, field: field.name, error: `${field.name} must be valid JSON` };
      }
    }
  }
  return { ok: true, args };
}
