import { Data, Effect } from "effect";
import { pantryConfig, pantryFetch, type PantryFullRecipe, type PantryListEntry } from "./pantry-client";
import type { Env } from "./types";

export class PantryRequestError extends Data.TaggedError("PantryRequestError")<{
  operation: "list" | "get";
  status?: number;
  cause: unknown;
}> {}

function headers(token: string): HeadersInit {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

function request(env: Env, operation: "list" | "get", url: string, token: string): Effect.Effect<Response, PantryRequestError> {
  return Effect.tryPromise({
    try: () => pantryFetch(env)(url, { headers: headers(token) }),
    catch: (cause) => new PantryRequestError({ operation, cause }),
  });
}

export function listPantryRecipes(env: Env): Effect.Effect<PantryListEntry[], PantryRequestError> {
  const { url, token } = pantryConfig(env);
  if (!token) return Effect.succeed([]);
  return Effect.gen(function* () {
    const response = yield* request(env, "list", `${url}/recipes`, token);
    if (!response.ok) return yield* Effect.fail(new PantryRequestError({ operation: "list", status: response.status, cause: `pantry list failed: ${response.status}` }));
    const body = yield* Effect.tryPromise({
      try: () => response.json() as Promise<{ recipes?: Array<Record<string, unknown>> }>,
      catch: (cause) => new PantryRequestError({ operation: "list", cause }),
    });
    return (body.recipes ?? []).map((recipe) => ({
      name: String(recipe.name ?? ""),
      description: String(recipe.description ?? ""),
      capabilities: Array.isArray(recipe.capabilities) ? recipe.capabilities.filter((c): c is string => typeof c === "string") : [],
      status: String(recipe.status ?? ""),
      version: typeof recipe.version === "number" ? recipe.version : undefined,
      source: "pantry" as const,
    })).filter((recipe) => recipe.name);
  });
}

export function getPantryRecipe(env: Env, name: string): Effect.Effect<PantryFullRecipe | null, PantryRequestError> {
  const { url, token } = pantryConfig(env);
  if (!token || !name) return Effect.succeed(null);
  return Effect.gen(function* () {
    const response = yield* request(env, "get", `${url}/recipe/${encodeURIComponent(name)}`, token);
    if (response.status === 404) return null;
    if (!response.ok) return yield* Effect.fail(new PantryRequestError({ operation: "get", status: response.status, cause: `pantry get failed: ${response.status}` }));
    const recipe = yield* Effect.tryPromise({
      try: () => response.json() as Promise<Record<string, unknown>>,
      catch: (cause) => new PantryRequestError({ operation: "get", cause }),
    });
    if (typeof recipe.code !== "string" || typeof recipe.name !== "string") return null;
    return {
      name: recipe.name,
      description: String(recipe.description ?? ""),
      inputSchema: recipe.inputSchema && typeof recipe.inputSchema === "object" && !Array.isArray(recipe.inputSchema) ? recipe.inputSchema as Record<string, unknown> : { type: "object", properties: {} },
      code: recipe.code,
      capabilities: Array.isArray(recipe.capabilities) ? recipe.capabilities.filter((c): c is string => typeof c === "string") : [],
      status: String(recipe.status ?? ""),
      version: typeof recipe.version === "number" ? recipe.version : undefined,
    };
  });
}
