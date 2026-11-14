import type { AccessIdentity } from "./auth";
import type { Env, ToolContext } from "./types";
import { createToolContext } from "./tool-context";
import { applyRunEvent } from "./fsm/run-status";
import { SavedRecipeService, hasRetiredRecipeCapability, recipeRunTitle, savedRecipeExecutionCode, validateRecipeRunInput } from "./saved-recipes";
import { executeWorkCode } from "./work-tools";
import { reserveSavedRecipeInvocation, type WorkCodeExecutionState } from "./computer-work-budget";
import { codemodeExecutionIdForRecipe, projectSavedRecipe } from "./cm-snippets";
import { intersectCapabilities } from "./capability-intersect";

export type SavedRecipeRunBody = { recipeId?: string; input?: Record<string, unknown>; callerCapabilities?: string[]; workCodeExecutionState?: WorkCodeExecutionState };

export type SavedRecipeHost = { env: Env; identity: AccessIdentity; sessionId: string; context: ToolContext };

export function headlessRecipeHost(env: Env, identity: AccessIdentity, sessionId: string): SavedRecipeHost {
  const host: SavedRecipeHost = {
    env,
    identity,
    sessionId,
    context: createToolContext({
      env,
      identity,
      sessionId,
      scope: { kind: "chat", chatId: sessionId },
      sandboxOnly: false,
      broadcast: () => undefined,
      runSavedRecipe: (body) => runSavedRecipe(host, body),
    }),
  };
  return host;
}

export async function runSavedRecipe(host: SavedRecipeHost, body: SavedRecipeRunBody) {
  const { env, identity, sessionId, context } = host;
  if (!identity?.email) throw new Error("session identity not seeded");
  const recipeId = body.recipeId?.trim();
  if (!recipeId) throw new Error("recipeId is required");
  const executionState = reserveSavedRecipeInvocation(body.workCodeExecutionState);
  const recipe = await new SavedRecipeService(env, identity.email).requireEnabled(recipeId);
  const runInput = validateRecipeRunInput(body.input ?? {}, JSON.parse(recipe.input_schema_json));
  const declaredCapabilities = JSON.parse(recipe.capabilities_json) as string[];
  if (hasRetiredRecipeCapability(declaredCapabilities)) {
    throw new Error("saved recipe is disabled because it uses a retired capability namespace");
  }
  const effectiveCapabilities = intersectCapabilities(body.callerCapabilities, declaredCapabilities);
  const codemodeExecutionId = await codemodeExecutionIdForRecipe(env, { id: recipe.id, name: recipe.name, owner_email: identity.email });
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO runs (id, owner_email, session_id, status, title, task_summary, bounds_json, created_at, updated_at)
    VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?)`).bind(
      runId,
      identity.email.toLowerCase(),
      sessionId,
      recipeRunTitle(recipe),
      recipe.description,
      JSON.stringify({
        kind: "saved_recipe",
        recipeId: recipe.id,
        declaredCapabilities,
        effectiveCapabilities,
        codemodeExecutionId,
      }),
      now,
      now,
    ).run();
  const actor = JSON.stringify({ id: "my-ax", kind: "coordinator", mode: "live" });
  await env.DB.prepare(`INSERT INTO run_events (run_id, event_id, owner_email, ts, actor_json, type, data_json, evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      runId,
      `evt-start-${crypto.randomUUID()}`,
      identity.email.toLowerCase(),
      now,
      actor,
      "recipe.started",
      JSON.stringify({
        recipeId: recipe.id,
        name: recipe.name,
        input: runInput,
        codemodeExecutionId,
        declaredCapabilities,
        effectiveCapabilities,
      }),
      null,
    ).run();
  const code = savedRecipeExecutionCode(recipe.code, runInput);
  const result = await executeWorkCode(code, {
    ...context,
    allowedWorkCapabilities: effectiveCapabilities,
    exposeSavedRecipes: false,
    workCodeExecutionState: executionState,
  });
  const terminal = result.ok ? "completed" : "failed";
  await env.DB.prepare(`INSERT INTO run_events (run_id, event_id, owner_email, ts, actor_json, type, data_json, evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      runId,
      `evt-${terminal}-${crypto.randomUUID()}`,
      identity.email.toLowerCase(),
      new Date().toISOString(),
      actor,
      `recipe.${terminal}`,
      JSON.stringify({
        recipeId: recipe.id,
        name: recipe.name,
        ok: result.ok,
        codemodeExecutionId,
      }),
      JSON.stringify(result),
    ).run();
  await applyRunEvent(env.DB, { id: runId, ownerEmail: identity.email.toLowerCase() }, result.ok ? "recipe_succeeded" : "recipe_failed");
  if (result.ok) {
    await projectSavedRecipe(env, recipe).catch((error) => console.error("cm_snippet_projection_failed", { recipeId: recipe.id, err: error instanceof Error ? error.message : String(error) }));
  }
  return { runId, recipe: { id: recipe.id, name: recipe.name }, execution: result, codemodeExecutionId, declaredCapabilities, effectiveCapabilities };
}
