import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCodemodeWorkRuntime, type CodemodeWorkSource, type CodemodeSnippetHook } from "./code-mode-runtime";
import { intersectCapabilities, capabilitiesDropped } from "./capability-intersect";
import { CODEMODE_METHODS, FACTORY_PAGE_METHODS, PAGE_WORK_METHODS, WORK_CODE_DESCRIPTION, WORK_SEARCH_DESCRIPTION, WORKSPACE_METHODS } from "./work-tools-catalog";

const source = readFileSync(new URL("./work-tools.ts", import.meta.url), "utf8");
const agent = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");
const runtime = readFileSync(new URL("./code-mode-runtime.ts", import.meta.url), "utf8");
const runtimeWorker = readFileSync(new URL("./code-mode-runtime.worker.ts", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");

// ────────────────────────────────────────────────────────────────────────────
// String-grep guards: keep the legacy recipe.* surface from re-appearing.
// ────────────────────────────────────────────────────────────────────────────

test("work_code description advertises codemode search/describe/run and not the legacy recipe surface", () => {
  assert.doesNotMatch(WORK_CODE_DESCRIPTION, /recipe\.list\(\)/);
  assert.doesNotMatch(WORK_CODE_DESCRIPTION, /recipe\.run\(/);
  assert.match(WORK_CODE_DESCRIPTION, /codemode\.search\(/);
  assert.match(WORK_CODE_DESCRIPTION, /codemode\.describe\(/);
  assert.match(WORK_CODE_DESCRIPTION, /codemode\.run\(/);
});

test("work_search catalog exposes codemode methods and no recipe.* entries", () => {
  const names = [...WORKSPACE_METHODS, ...PAGE_WORK_METHODS, ...CODEMODE_METHODS].map((method) => method.name as string);
  assert.equal(names.some((name) => name.startsWith("recipe")), false);
  assert.deepEqual(CODEMODE_METHODS.map((method) => method.name), ["search", "describe", "run"]);
  assert.equal(CODEMODE_METHODS[0].description, "List or filter codemode tools across My AX Workspace and reusable tools.");
  assert.doesNotMatch(WORK_SEARCH_DESCRIPTION, /Computer, My Machine, Terrarium, AgentCast/);
});

test("factory chats only get the safe page subset", () => {
  assert.deepEqual(FACTORY_PAGE_METHODS.map((method) => method.name).sort(), ["deskRead", "deskWrite", "listSessions", "sendToSession"]);
  assert.ok(FACTORY_PAGE_METHODS.length > 0 && FACTORY_PAGE_METHODS.length < PAGE_WORK_METHODS.length);
  for (const method of FACTORY_PAGE_METHODS) assert.ok(["listSessions", "sendToSession", "deskRead", "deskWrite"].includes(method.name));
});

test("work_code invokes submitted async arrow with ctx while preserving globals", () => {
  assert.match(source, /globalThis\.ctx=\{workspace:globalThis\.workspace,machine:globalThis\.machine,page:globalThis\.page,codemode:globalThis\.codemode\}/);
  assert.doesNotMatch(source, /globalThis\.ctx=\{[^}]*computer:|globalThis\.ctx=\{[^}]*terrarium:|globalThis\.ctx=\{[^}]*agentcast:/);
  assert.match(source, /const executableCode = `async \(\) => await \(\$\{submittedCode\}\)\(globalThis\.ctx\)`/);
  assert.match(source, /executor\.execute\(executableCode,/);
});

test("work_code wires the page.* namespace into bridgeFns and the sandbox prelude", () => {
  // Regression guard: the page connector was registered as a codemode source
  // but the bare `page.*` global was never spliced into the work_code scope,
  // so `page.listSessions()` threw 'page is not defined' in prod.
  assert.match(source, /page_\$\{name\}/, "page_* dispatchers must be added to bridgeFns");
  assert.match(source, /pagePrelude = executionContext\.callPage \? namespace\("page"/, "page namespace must be conditionally spliced into the prelude");
  assert.match(source, /page:globalThis\.page/, "page must be present on globalThis.ctx");
});

test("agent system prompt no longer references recipe.list / recipe.run", () => {
  assert.doesNotMatch(agent, /recipe\.list\(\)/);
  assert.doesNotMatch(agent, /recipe\.run\(\{id\|name/);
  assert.match(agent, /codemode\.run\(name, input\)/);
});

test("native CodemodeRuntime seam is held (round 04): runNativeCodemode is available but the DO binding/export/v12 migration are intentionally not wired until the first call site lands", () => {
  // Type alias remains so callers (including future cutover code) can
  // reference the canonical CodemodeRuntime DO type without importing
  // @cloudflare/codemode directly.
  assert.match(runtime, /export type \{ CodemodeRuntime \} from "@cloudflare\/codemode"/);
  // The DO class re-export and the native runtime builder live in the
  // worker-only seam so a future cutover (call site + binding + migration
  // + types) can flip them together.
  assert.match(runtimeWorker, /export \{ CodemodeRuntime \} from "@cloudflare\/codemode"/);
  assert.match(runtimeWorker, /createCodemodeRuntime/);
  assert.match(runtimeWorker, /export function runNativeCodemode/);
  // HOLD #1: src/index.tsx must NOT actively export CodemodeRuntime as a
  // DO class, because no binding is declared in wrangler.jsonc yet.
  // Shipping the export with no binding would be a dangling DO class;
  // shipping the binding with no call site would be a forward-only DO
  // migration for dead wiring (round 04 review, blocker #2).
  assert.doesNotMatch(
    indexSource,
    /^export \{ CodemodeRuntime \} from "\.\/code-mode-runtime\.worker"/m,
    "src/index.tsx must not actively export CodemodeRuntime until the binding and call site land together",
  );
  assert.doesNotMatch(indexSource, /^export const CODEMODE_RUNTIME_HOLD/m);
});

test("wrangler.jsonc holds CODEMODE_RUNTIME until a real runNativeCodemode call site exists", () => {
  const wrangler = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  // No active CODEMODE_RUNTIME binding line (only comments referencing it
  // by name are allowed). Strip JSONC line-comments before checking so
  // the held-pattern note does not trigger a false positive.
  const stripped = wrangler.replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(
    stripped,
    /"name":\s*"CODEMODE_RUNTIME"/,
    "wrangler.jsonc must not declare a CODEMODE_RUNTIME binding while runNativeCodemode has no call site",
  );
  assert.doesNotMatch(
    stripped,
    /"tag":\s*"v12-codemode-runtime"/,
    "wrangler.jsonc must not declare the v12-codemode-runtime migration while runNativeCodemode has no call site",
  );
  assert.match(wrangler, /intentionally NOT bound here yet/);
});

test("snippet description stays honest about projected provenance (no claim of native CodemodeRuntime promotion)", () => {
  // The work_code description must not promise that any snippet today
  // is backed by a real CodemodeRuntime execution. Round 04 review
  // blocker #2: keep projected language honest while the runtime path
  // is held.
  assert.match(agent, /projected provenance|projected"/);
  assert.doesNotMatch(
    agent,
    /native promotions carry a real CodemodeRuntime execution id/,
    "agent.ts must not advertise live native CodemodeRuntime promotions while the runtime path is held",
  );
});

// ────────────────────────────────────────────────────────────────────────────
// Behavioral tests for the in-process codemode runtime.
// ────────────────────────────────────────────────────────────────────────────

function makeSource(name: string, tools: Array<{ name: string; description: string; result?: unknown }>): CodemodeWorkSource {
  const fns: Record<string, (input: unknown) => Promise<unknown>> = {};
  const toolDefs = tools.map((tool) => {
    fns[tool.name] = async (input) => ({ ran: `${name}.${tool.name}`, input, result: tool.result ?? null });
    return { name: tool.name, description: tool.description, execute: fns[tool.name] };
  });
  return {
    connector: { name, description: `${name} connector`, tools: toolDefs },
    fns,
  };
}

test("codemode.search lists every connector tool and snippet without legacy recipe.* surface", async () => {
  const sources = [
    makeSource("workspace", [{ name: "read", description: "Read a workspace file." }]),
    makeSource("machine", [{ name: "shell", description: "Run a shell command on the machine." }]),
  ];
  const snippetHook: CodemodeSnippetHook = {
    async list() {
      return [
        { id: "s1", name: "demo_snippet", description: "demo snippet", inputSchema: { type: "object", properties: {} }, capabilities: ["workspace.read"], codemodeExecutionId: "cm_synth_s1", sourceRecipeId: "s1", provenance: "projected" },
      ];
    },
    async run() { return { ok: true }; },
  };
  const wr = createCodemodeWorkRuntime(sources, snippetHook);
  const result = await wr.namespace.search("");
  const tools = result.matches.map((m) => `${m.connector}.${m.tool}`);
  assert.ok(tools.includes("workspace.read"));
  assert.ok(tools.includes("machine.shell"));
  assert.ok(tools.includes("snippet.demo_snippet"));
  assert.ok(!tools.some((name) => name.startsWith("recipe.")), "no legacy recipe.* surface");
});

test("codemode.describe returns native tool schema for connectors and snippets", async () => {
  const sources = [makeSource("workspace", [{ name: "read", description: "Read a file." }])];
  const snippetHook: CodemodeSnippetHook = {
    async list() {
      return [{
        id: "s1",
        name: "fetch_thing",
        description: "Fetch a thing.",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        capabilities: ["workspace.read"],
        codemodeExecutionId: "cm_synth_s1",
        sourceRecipeId: "s1",
        provenance: "projected",
      }];
    },
    async run() { return { ok: true }; },
  };
  const wr = createCodemodeWorkRuntime(sources, snippetHook);
  const workspaceRead = await wr.namespace.describe("workspace.read");
  assert.ok(workspaceRead);
  assert.equal(workspaceRead!.connector, "workspace");
  assert.equal(workspaceRead!.tool, "read");
  const snippet = await wr.namespace.describe("fetch_thing");
  assert.ok(snippet);
  assert.equal(snippet!.connector, "snippet");
  assert.equal(snippet!.tool, "fetch_thing");
  const missing = await wr.namespace.describe("bogus.nope");
  assert.equal(missing, null);
});

test("codemode.run dispatches connector tools and snippet by name through the hook", async () => {
  const sources = [makeSource("workspace", [{ name: "read", description: "Read a file." }])];
  let calledWith: { name?: string; input?: Record<string, unknown> } | null = null;
  const snippetHook: CodemodeSnippetHook = {
    async list() {
      return [{ id: "s1", name: "fetch_thing", description: "Fetch.", inputSchema: { type: "object", properties: {} }, capabilities: ["workspace.read"] }];
    },
    async run(input) { calledWith = input; return { snippetRan: input.name }; },
  };
  const wr = createCodemodeWorkRuntime(sources, snippetHook);
  const direct = await wr.namespace.run("workspace.read", { path: "/x" });
  assert.deepEqual(direct, { ran: "workspace.read", input: { path: "/x" }, result: null });
  const viaName = await wr.namespace.run("fetch_thing", { kind: "y" });
  assert.deepEqual(viaName, { snippetRan: "fetch_thing" });
  assert.deepEqual(calledWith, { name: "fetch_thing", input: { kind: "y" } });
});

test("codemode.run on an unknown name without a snippet hook surfaces a clear error", async () => {
  const wr = createCodemodeWorkRuntime([makeSource("workspace", [{ name: "read", description: "Read a file." }])], undefined);
  await assert.rejects(() => wr.namespace.run("nope"), /codemode\.run: unknown tool/);
});

// ────────────────────────────────────────────────────────────────────────────
// Capability intersection: a snippet cannot widen the caller's bounds.
// Round 02 objection #7.
// ────────────────────────────────────────────────────────────────────────────

test("intersectCapabilities never widens the caller's grant set", () => {
  assert.deepEqual(intersectCapabilities(["workspace.read"], ["workspace.read", "machine.shell"]), ["workspace.read"]);
  assert.deepEqual(intersectCapabilities([], ["workspace.read"]), []);
  // An undefined caller bound is treated as unrestricted (legacy top-level
  // turn), so the declared list applies as-is.
  assert.deepEqual(intersectCapabilities(undefined, ["workspace.read", "machine.shell"]), ["machine.shell", "workspace.read"]);
});

test("capabilitiesDropped explains what a snippet declared but the caller did not grant", () => {
  assert.deepEqual(capabilitiesDropped(["workspace.read"], ["workspace.read", "machine.shell"]), ["machine.shell"]);
  assert.deepEqual(capabilitiesDropped(undefined, ["workspace.read"]), []);
});

// ────────────────────────────────────────────────────────────────────────────
// The snippet hook builder passes the caller's bounds into runSavedRecipe so
// the intersection happens at the run boundary.
// ────────────────────────────────────────────────────────────────────────────

test("buildSnippetHook forwards callerCapabilities to runSavedRecipe so capabilities are intersected, not broadened", () => {
  // We don't run a real recipe here (that requires the live DO); we assert
  // the source threads ctx.allowedWorkCapabilities through the hook into
  // runSavedRecipe so the intersection happens at the call boundary.
  assert.match(source, /callerCapabilities:\s*ctx\.allowedWorkCapabilities/);
  assert.match(source, /workCodeExecutionState:\s*ctx\.workCodeExecutionState/);
  assert.match(agent, /reserveSavedRecipeInvocation\(body\.workCodeExecutionState\)/);
  assert.match(agent, /workCodeExecutionState:\s*input\.workCodeExecutionState/);
  assert.match(agent, /workCodeExecutionState:\s*executionState/);
  assert.match(agent, /intersectCapabilities\(\s*body\.callerCapabilities\s*,\s*declaredCapabilities\s*\)/);
});

test("saved recipe root budget is reserved before receipts and nested recipes remain disabled", () => {
  assert.ok(agent.indexOf("reserveSavedRecipeInvocation(body.workCodeExecutionState)") < agent.indexOf("INSERT INTO runs"));
  assert.match(agent, /exposeSavedRecipes: false/);
});

test("work_code wires saved recipes through the codemode snippet hook with capability intersection", () => {
  assert.match(source, /function buildSnippetHook/);
  assert.match(source, /ctx\.listSavedRecipes/);
  assert.match(source, /ctx\.runSavedRecipe/);
  assert.match(source, /ctx\.exposeSavedRecipes === false/);
  assert.match(source, /createCodemodeWorkRuntime\(codemodeSources, snippetHook\)/);
  assert.match(source, /function restrictByCapabilities/);
  assert.match(source, /allowedWorkCapabilities/);
  assert.match(source, /capability not granted/);
});
