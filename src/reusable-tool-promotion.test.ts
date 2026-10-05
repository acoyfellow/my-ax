import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { promoteWorkCodeCandidates, type PromotionDependencies, type RecipeCreateInput, type ReusableToolTrustMode } from "./reusable-tool-promotion";
import { SavedRecipeError } from "./saved-recipes";

const agent = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");
const workTools = readFileSync(new URL("./work-tools.ts", import.meta.url), "utf8");

type RecipeNotification = Parameters<PromotionDependencies["notifyOwner"]>[0];

interface Harness {
  deps: PromotionDependencies;
  created: RecipeCreateInput[];
  projected: string[];
  notifications: RecipeNotification[];
  logs: { event: string; detail: Record<string, unknown> }[];
}

function harness(options: { existingNames?: string[]; createError?: Error } = {}): Harness {
  const names = new Set(options.existingNames ?? []);
  const created: RecipeCreateInput[] = [];
  const projected: string[] = [];
  const notifications: RecipeNotification[] = [];
  const logs: Harness["logs"] = [];
  const deps: PromotionDependencies = {
    async createRecipe(input) {
      if (options.createError) throw options.createError;
      if (names.has(input.name)) throw new SavedRecipeError("Conflict", "saved recipe name already exists");
      names.add(input.name);
      created.push(input);
      return { id: `id-${input.name}`, name: input.name, description: input.description, status: input.status };
    },
    async projectEnabledRecipe(recipeId) { projected.push(recipeId); },
    async notifyOwner(notification) { notifications.push(notification); },
    logError(event, detail) { logs.push({ event, detail }); },
    now: () => 42,
  };
  return { deps, created, projected, notifications, logs };
}

interface PartOptions {
  eligible?: boolean;
  capabilities?: string[];
  portable?: boolean;
  ok?: boolean;
  type?: string;
  toolName?: string;
  state?: string;
}

function workCodePart(name: string, options: PartOptions = {}) {
  return {
    type: options.type ?? "tool-work_code",
    toolName: options.toolName,
    state: options.state ?? "output-available",
    output: {
      ok: options.ok ?? true,
      suggestedRecipe: {
        name,
        description: `${name} description.`,
        inputSchema: { type: "object", properties: {} },
        code: "return 1;",
        capabilities: options.capabilities ?? ["workspace.read"],
        ...(options.portable === undefined ? {} : { portable: options.portable }),
      },
      reusableToolCandidate: { eligible: options.eligible ?? true, fingerprint: `fp-${name}` },
    },
  };
}

function promote(parts: unknown[], trustMode: ReusableToolTrustMode, h: Harness) {
  return promoteWorkCodeCandidates({ parts, trustMode, sourceRunId: "session-1", deps: h.deps });
}

test("a duplicate candidate is skipped and the next candidate still persists", async () => {
  const h = harness({ existingNames: ["Dup"] });
  const receipts = await promote([workCodePart("Dup"), workCodePart("Fresh")], "review", h);
  assert.deepEqual(h.created.map((c) => c.name), ["Fresh"]);
  assert.deepEqual(receipts, [
    { ok: false, fingerprint: "fp-Dup", reason: "Conflict", error: "saved recipe name already exists" },
    { id: "id-Fresh", name: "Fresh", status: "pending", trustMode: "review", fingerprint: "fp-Fresh" },
  ]);
  assert.equal(h.logs[0].event, "recipe_promotion_skipped");
  assert.equal(h.logs[0].detail.code, "Conflict");
  assert.deepEqual(h.notifications.map((n) => n.title), ["Review reusable tool: Fresh"]);
});

test("failures other than SavedRecipeError are not swallowed", async () => {
  const h = harness({ createError: new Error("db down") });
  await assert.rejects(promote([workCodePart("A")], "review", h), /db down/);
});

test("review mode persists pending, notifies the owner with the Settings deep-link, and does not project", async () => {
  const h = harness();
  await promote([workCodePart("My Tool")], "review", h);
  assert.equal(h.created[0].status, "pending");
  assert.equal(h.created[0].sourceRunId, "session-1");
  assert.deepEqual(h.projected, []);
  assert.equal(h.notifications.length, 1);
  const notification = h.notifications[0];
  assert.equal(notification.kind, "recipe.approval");
  assert.equal(notification.title, "Review reusable tool: My Tool");
  assert.equal(notification.href, "/?action=settings&section=recipes&recipe=My%20Tool");
  assert.doesNotMatch(notification.href ?? "", /\/api\/recipes\//);
});

test("auto mode persists enabled, projects into Code Mode, and skips the review notification", async () => {
  const h = harness();
  const receipts = await promote([workCodePart("Auto")], "auto", h);
  assert.equal(h.created[0].status, "enabled");
  assert.deepEqual(h.projected, ["id-Auto"]);
  assert.deepEqual(h.notifications, []);
  assert.deepEqual(receipts, [{ id: "id-Auto", name: "Auto", status: "enabled", trustMode: "auto", fingerprint: "fp-Auto" }]);
});

test("only completed work_code tool outputs are eligible", async () => {
  const h = harness();
  await promote([
    workCodePart("Other", { type: "tool-work_run" }),
    workCodePart("CallOther", { type: "tool-call", toolName: "work_run" }),
    workCodePart("NotReady", { state: "input-available" }),
    workCodePart("ByToolName", { type: "tool-call", toolName: "work_code" }),
  ], "review", h);
  assert.deepEqual(h.created.map((c) => c.name), ["ByToolName"]);
});

test("candidates without an eligible reusableToolCandidate or ok output are not persisted", async () => {
  const h = harness();
  await promote([
    workCodePart("Ineligible", { eligible: false }),
    workCodePart("Failed", { ok: false }),
    { type: "tool-work_code", state: "output-available", output: "not json" },
  ], "review", h);
  assert.deepEqual(h.created, []);
});

test("high-authority non-portable candidates stay inline-only in every mode", async () => {
  for (const mode of ["review", "auto"] as const) {
    const h = harness();
    await promote([workCodePart("Machine", { capabilities: ["machine.exec"], portable: false })], mode, h);
    assert.deepEqual(h.created, []);
    assert.deepEqual(h.notifications, []);
  }
});

test("agent delegates promotion to the tested core using the owner preference service", () => {
  const start = agent.indexOf("private async promoteSuggestedRecipe(");
  assert.ok(start >= 0, "promoteSuggestedRecipe must exist in agent.ts");
  const slice = agent.slice(start, start + 3000);
  assert.match(agent, /import \{ reusableToolApprovalMode \} from "\.\/reusable-tool-preferences-program"/);
  assert.match(slice, /reusableToolApprovalMode\(identity\.email, fallback\)\.pipe\(Effect\.provide\(databaseLayer\(this\.env\.DB\)\)\)/);
  assert.match(slice, /promoteWorkCodeCandidates\(/);
  assert.match(slice, /recipesSavedThisTurn\.push\(\.\.\.receipts\)/);
  assert.doesNotMatch(slice, /const (?:trustMode|autoEnable) = autoTrustMode\(this\.env\)/);
});

test("executeWorkCode returns a reusableToolCandidate alongside suggestedRecipe (compat preserved)", () => {
  assert.match(workTools, /suggestedRecipe,/, "suggestedRecipe compatibility field must remain");
  assert.match(workTools, /reusableToolCandidate,/, "reusableToolCandidate must be added");
  assert.match(workTools, /reusableToolApprovalMode: reusableToolApprovalModeValue,/, "owner approval mode must be included for truthful card actions");
  assert.match(workTools, /evaluateReusableToolCandidate\(/);
  assert.match(workTools, /reusableToolNameFromMarker\(code,/, "marker name must win over the fallback heuristic");
});

test("work_code tool description explains the marker semantics and its narrow scope", () => {
  const desc = workTools.match(/WORK_CODE_TOOL[\s\S]*?description:\s*"([^"]+)"/);
  assert.ok(desc, "work_code description literal must be present");
  assert.match(desc![1], /reusable-tool:/, "description must document the marker prefix");
  assert.match(desc![1], /broadly reusable/, "description must explain the marker is for broadly reusable code");
  assert.match(desc![1], /one-off|Never add the marker/, "description must warn against marking one-off commands");
});

test("public agent system prompt teaches the marker semantics", () => {
  const promptSlice = agent.slice(agent.indexOf("PUBLIC_SYSTEM"), agent.indexOf("PUBLIC_SYSTEM") + 5000);
  assert.match(promptSlice, /reusable-tool:/, "system prompt must show the marker prefix");
  assert.match(promptSlice, /broadly reusable/, "system prompt must explain the marker is for broadly reusable code");
  assert.match(promptSlice, /Settings\s*→\s*Reusable tools|Settings.*Reusable tools/, "system prompt should use the owner-facing Reusable tools destination");
});
