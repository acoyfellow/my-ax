import assert from "node:assert/strict";
import test from "node:test";
import { syncRecipesToPantry, pushRecipe, mapRecipeToPantryBody } from "./pantry-sync";
import type { SavedRecipe } from "./saved-recipes";
import type { Env } from "./types";

function makeRow(over: Partial<SavedRecipe> = {}): SavedRecipe {
  return {
    id: over.id ?? "id-1",
    owner_email: "owner@example.com",
    name: over.name ?? "myax_demo",
    description: over.description ?? "A demo recipe from my-ax.",
    input_schema_json: over.input_schema_json ?? JSON.stringify({ type: "object", properties: { path: { type: "string" } } }),
    code: over.code ?? "return await workspace.read({ path: input.path });",
    capabilities_json: over.capabilities_json ?? JSON.stringify(["workspace.read"]),
    source_run_id: over.source_run_id ?? "run-9",
    status: over.status ?? "enabled",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

// Minimal D1 mock that supports SavedRecipeService.list() (SELECT ... all) and
// get(id) (SELECT ... first). It routes by whether the SQL has "= ?" on id.
function makeEnv(rows: SavedRecipe[], extra: Partial<Env> = {}): Env {
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async all<T>() {
          return { results: rows as unknown as T[] };
        },
        async first<T>() {
          const id = bound[0];
          const found = rows.find((r) => r.id === id);
          return (found ?? null) as unknown as T;
        },
      };
      void sql;
      return stmt;
    },
  };
  return { DB: db, ...extra } as unknown as Env;
}

test("syncRecipesToPantry no-ops with a clear flag when PANTRY_TOKEN is unset", async () => {
  const env = makeEnv([makeRow()], { PANTRY_URL: "https://pantry.coey.dev" } as Partial<Env>);
  let called = false;
  const fetchMock = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const result = await syncRecipesToPantry(env, "owner@example.com", fetchMock);
  assert.equal(result.configured, false);
  assert.equal(result.attempted, false);
  assert.deepEqual(result.pushed, []);
  assert.equal(called, false, "must not hit the network without a token");
});

test("syncRecipesToPantry pushes only enabled recipes and maps fields correctly", async () => {
  const rows = [
    makeRow({ id: "a", name: "enabled_one", status: "enabled" }),
    makeRow({ id: "b", name: "disabled_one", status: "disabled" }),
  ];
  const env = makeEnv(rows, { PANTRY_TOKEN: "secret-xyz", PANTRY_URL: "https://pantry.coey.dev" } as Partial<Env>);
  const bodies: { url: string; init: RequestInit }[] = [];
  const fetchMock = (async (url: string, init: RequestInit) => {
    bodies.push({ url, init });
    return new Response(JSON.stringify({ name: "enabled_one", version: 1 }), { status: 200 });
  }) as unknown as typeof fetch;

  const result = await syncRecipesToPantry(env, "owner@example.com", fetchMock);
  assert.equal(result.configured, true);
  assert.equal(result.attempted, true);

  const pushed = result.pushed.filter((p) => p.status === "pushed");
  const skipped = result.pushed.filter((p) => p.status === "skipped");
  assert.equal(pushed.length, 1, "only the enabled recipe is pushed");
  assert.equal(pushed[0].name, "enabled_one");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].name, "disabled_one");

  // Exactly one network call (the enabled one), correct endpoint + mapping.
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].url, "https://pantry.coey.dev/recipes");
  assert.equal((bodies[0].init as { method: string }).method, "POST");
  const sent = JSON.parse((bodies[0].init.body as string));
  assert.equal(sent.name, "enabled_one");
  assert.equal(sent.description, "A demo recipe from my-ax.");
  assert.deepEqual(sent.inputSchema, { type: "object", properties: { path: { type: "string" } } });
  assert.equal(sent.code, "return await workspace.read({ path: input.path });");
  assert.deepEqual(sent.capabilities, ["workspace.read"]);
});

test("pushRecipe sends the token only in the Authorization header and never logs it", async () => {
  const token = "super-secret-token-DO-NOT-LOG";
  const env = makeEnv([], { PANTRY_TOKEN: token, PANTRY_URL: "https://pantry.coey.dev" } as Partial<Env>);
  let authHeader = "";
  const fetchMock = (async (_url: string, init: RequestInit) => {
    authHeader = (init.headers as Record<string, string>).authorization;
    return new Response(JSON.stringify({ name: "x", version: 2 }), { status: 200 });
  }) as unknown as typeof fetch;

  const logs: string[] = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...a: unknown[]) => logs.push(JSON.stringify(a));
  console.warn = (...a: unknown[]) => logs.push(JSON.stringify(a));
  try {
    const result = await pushRecipe(env, makeRow({ name: "x" }), fetchMock);
    assert.equal(result.status, "pushed");
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
  assert.equal(authHeader, `Bearer ${token}`);
  for (const line of logs) {
    assert.ok(!line.includes(token), `log line must not contain the token: ${line}`);
  }
});

test("syncRecipesToPantry is fail-soft on a network error (never throws)", async () => {
  const env = makeEnv([makeRow({ name: "neterr" })], { PANTRY_TOKEN: "secret", PANTRY_URL: "https://pantry.coey.dev" } as Partial<Env>);
  const fetchMock = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;

  const logs: string[] = [];
  const origWarn = console.warn;
  console.warn = (...a: unknown[]) => logs.push(JSON.stringify(a));
  let result;
  try {
    result = await syncRecipesToPantry(env, "owner@example.com", fetchMock);
  } finally {
    console.warn = origWarn;
  }
  assert.equal(result.attempted, true);
  assert.equal(result.pushed.length, 1);
  assert.equal(result.pushed[0].status, "failed");
  // The error reason must not contain a token (token never enters this path's logs).
  for (const line of logs) assert.ok(!line.includes("secret"), line);
});

test("pushRecipe skips a recipe with zero capabilities (pantry requires non-empty)", async () => {
  const env = makeEnv([], { PANTRY_TOKEN: "secret" } as Partial<Env>);
  let called = false;
  const fetchMock = (async () => {
    called = true;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const result = await pushRecipe(env, makeRow({ capabilities_json: "[]" }), fetchMock);
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /zero capabilities/);
  assert.equal(called, false, "no network call for a skipped recipe");
});

test("mapRecipeToPantryBody parses JSON fields and passes capabilities through verbatim", () => {
  const body = mapRecipeToPantryBody(makeRow({ capabilities_json: JSON.stringify(["workspace.read", "machine.exec"]) }));
  assert.deepEqual(body.capabilities, ["workspace.read", "machine.exec"]);
  assert.equal(body.status, "enabled");
  assert.equal(body.sourceRunId, "run-9");
  assert.deepEqual(body.inputSchema, { type: "object", properties: { path: { type: "string" } } });
});

test("pushRecipe defaults PANTRY_URL to pantry.coey.dev when unset", async () => {
  const env = makeEnv([], { PANTRY_TOKEN: "secret" } as Partial<Env>);
  let seenUrl = "";
  const fetchMock = (async (url: string) => {
    seenUrl = url;
    return new Response(JSON.stringify({ name: "x", version: 1 }), { status: 200 });
  }) as unknown as typeof fetch;
  await pushRecipe(env, makeRow(), fetchMock);
  assert.equal(seenUrl, "https://pantry.coey.dev/recipes");
});
