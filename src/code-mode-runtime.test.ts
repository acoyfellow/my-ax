import assert from "node:assert/strict";
import { CODE_MODE_EXECUTION_TIMEOUT_MS, createCodemodeWorkRuntime, type CodemodeWorkSource } from "./code-mode-runtime";

const test = (process.env.VITEST
  ? (await import("vit" + "est")).test
  : (await import("node:test")).default) as (name: string, fn: () => void | Promise<void>) => void;

test("Code Mode execution timeout follows the current runtime cohort", () => {
  assert.equal(CODE_MODE_EXECUTION_TIMEOUT_MS, 60_000);
});

test("codemode.run dispatches an explicit empty argument object", async () => {
  let received: unknown;
  const source: CodemodeWorkSource = {
    connector: { name: "workspace", description: "workspace connector", tools: [{ name: "list", description: "List files.", execute: async () => null }] },
    fns: {
      list: async (input) => {
        received = input;
        return { ok: true };
      },
    },
  };
  const runtime = createCodemodeWorkRuntime([source]);
  assert.deepEqual(await runtime.namespace.run("workspace.list", {}), { ok: true });
  assert.deepEqual(received, {});
});

test("codemode.run parses JSON string arguments before dispatch", async () => {
  let received: unknown;
  const source: CodemodeWorkSource = {
    connector: { name: "workspace", description: "workspace connector", tools: [{ name: "read", description: "Read a file.", execute: async () => null }] },
    fns: {
      read: async (input) => {
        received = input;
        return input;
      },
    },
  };
  const runtime = createCodemodeWorkRuntime([source]);
  const expected = { path: "/home/user/notes.txt", recursive: false };
  assert.deepEqual(await runtime.namespace.run("workspace.read", JSON.stringify(expected)), expected);
  assert.deepEqual(received, expected);
});

test("codemode bridge preserves nested arguments from a JSON dispatch payload", async () => {
  let received: unknown;
  const source: CodemodeWorkSource = {
    connector: { name: "workspace", description: "workspace connector", tools: [{ name: "search", description: "Search files.", execute: async () => null }] },
    fns: {
      search: async (input) => {
        received = input;
        return input;
      },
    },
  };
  const runtime = createCodemodeWorkRuntime([source]);
  const expected = {
    query: { all: ["status:open", { owner: { email: "owner@example.com" } }] },
    filters: { labels: ["bug", "priority:high"], includeArchived: false },
  };
  assert.deepEqual(await runtime.bridgeFns["codemode__run"](JSON.stringify({ name: "workspace.search", input: expected })), expected);
  assert.deepEqual(received, expected);
});
