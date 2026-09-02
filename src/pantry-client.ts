import type { Env } from "./types";

const DEFAULT_PANTRY_URL = "https://pantry.coey.dev";

export type PantryListEntry = {
  name: string;
  description: string;
  capabilities: string[];
  status: string;
  version?: number;
  source: "pantry";
};

export type PantryFullRecipe = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  code: string;
  capabilities: string[];
  status: string;
  version?: number;
};

type PantryBindings = {
  PANTRY_URL?: string;
  PANTRY_TOKEN?: string;
  PANTRY?: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
};

export function pantryConfig(env: Env): { url: string; token: string | undefined } {
  const raw = env as unknown as PantryBindings;
  const url = (raw.PANTRY_URL || DEFAULT_PANTRY_URL).replace(/\/+$/, "");
  const token = raw.PANTRY_TOKEN || undefined;
  return { url, token };
}

export function pantryFetch(env: Env): typeof fetch {
  const pantry = (env as unknown as PantryBindings).PANTRY;
  if (!pantry) return fetch;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const parsed = new URL(href, "https://pantry.internal");
    return pantry.fetch(new Request(`https://pantry.internal${parsed.pathname}${parsed.search}`, init));
  }) as typeof fetch;
}

function authHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

export async function listPantryRecipes(env: Env): Promise<PantryListEntry[]> {
  const { url, token } = pantryConfig(env);
  if (!token) return [];
  const res = await pantryFetch(env)(`${url}/recipes`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`pantry list failed: ${res.status}`);
  const body = (await res.json()) as { recipes?: Array<Record<string, unknown>> };
  return (body.recipes ?? []).map((recipe) => ({
    name: String(recipe.name ?? ""),
    description: String(recipe.description ?? ""),
    capabilities: Array.isArray(recipe.capabilities) ? recipe.capabilities.filter((c): c is string => typeof c === "string") : [],
    status: String(recipe.status ?? ""),
    version: typeof recipe.version === "number" ? recipe.version : undefined,
    source: "pantry" as const,
  })).filter((recipe) => recipe.name);
}

export async function getPantryRecipe(env: Env, name: string): Promise<PantryFullRecipe | null> {
  const { url, token } = pantryConfig(env);
  if (!token || !name) return null;
  const res = await pantryFetch(env)(`${url}/recipe/${encodeURIComponent(name)}`, { headers: authHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`pantry get failed: ${res.status}`);
  const recipe = (await res.json()) as Record<string, unknown>;
  if (typeof recipe.code !== "string" || typeof recipe.name !== "string") return null;
  return {
    name: recipe.name,
    description: String(recipe.description ?? ""),
    inputSchema: recipe.inputSchema && typeof recipe.inputSchema === "object" && !Array.isArray(recipe.inputSchema)
      ? recipe.inputSchema as Record<string, unknown>
      : { type: "object", properties: {} },
    code: recipe.code,
    capabilities: Array.isArray(recipe.capabilities) ? recipe.capabilities.filter((c): c is string => typeof c === "string") : [],
    status: String(recipe.status ?? ""),
    version: typeof recipe.version === "number" ? recipe.version : undefined,
  };
}

export function pantryRecipeExecutionCode(recipeCode: string): string {
  const trimmed = recipeCode.trim().replace(/;+$/, "");
  const callable = /^(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(trimmed)
    || /^(async\s+)?function\b/.test(trimmed)
    || /\bexport\s+default\b/.test(trimmed);
  if (callable) {
    return `async (input) => { const ctx = { input, bindings: globalThis.ctx }; const __fn = ${trimmed}; return typeof __fn === "function" ? await __fn(input, ctx) : __fn; }`;
  }
  return `async (input) => { const ctx = { input, bindings: globalThis.ctx }; ${recipeCode}\n}`;
}
