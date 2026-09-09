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
