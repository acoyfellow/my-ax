import type { ReusableToolCandidate } from "./reusable-tool-candidate";
import { recipeApprovalDecision, shouldPersistSuggestedRecipe } from "./recipe-approval-policy";
import { SavedRecipeError } from "./saved-recipes";
import type { OwnerNotification } from "./notify";

export type ReusableToolTrustMode = "auto" | "review";

export interface PromotedRecipe {
  id: string;
  name: string;
  description: string;
  status: string;
}

export interface RecipeCreateInput {
  name: string;
  description: string;
  inputSchema: unknown;
  code: string;
  capabilities: string[];
  sourceRunId: string;
  status: "enabled" | "pending";
}

export interface PromotionDependencies {
  createRecipe(input: RecipeCreateInput): Promise<PromotedRecipe>;
  projectEnabledRecipe(recipeId: string): Promise<void>;
  notifyOwner(notification: Omit<OwnerNotification, "sessionId"> & { kind: "recipe.approval" }): Promise<unknown>;
  logError(event: string, detail: Record<string, unknown>): void;
  now(): number;
}

export type PromotionReceipt =
  | { id: string; name: string; status: string; trustMode: ReusableToolTrustMode; fingerprint: string }
  | { ok: false; fingerprint: string; reason: SavedRecipeError["code"]; error: string };

interface ParsedWorkCodeOutput {
  ok?: boolean;
  suggestedRecipe?: unknown;
  reusableToolCandidate?: unknown;
}

export function workCodeOutputs(parts: readonly unknown[]): unknown[] {
  return parts.flatMap((part) => {
    const candidate = part as { type?: string; toolName?: string; output?: unknown; state?: string };
    if (candidate.state !== "output-available") return [];
    const isWorkCode = candidate.type === "tool-work_code"
      || (candidate.type?.startsWith("tool-") && candidate.toolName === "work_code");
    return isWorkCode ? [candidate.output] : [];
  });
}

function parseWorkCodeOutput(output: unknown): ParsedWorkCodeOutput | null {
  const text = typeof output === "string" ? output : JSON.stringify(output);
  try {
    return JSON.parse(text) as ParsedWorkCodeOutput;
  } catch {
    return null;
  }
}

export function reusableToolReviewHref(recipeName: string): string {
  return `/?action=settings&section=recipes&recipe=${encodeURIComponent(recipeName)}`;
}

export async function promoteWorkCodeCandidates(input: {
  parts: readonly unknown[];
  trustMode: ReusableToolTrustMode;
  sourceRunId: string;
  deps: PromotionDependencies;
}): Promise<PromotionReceipt[]> {
  const { trustMode, sourceRunId, deps } = input;
  const autoEnable = trustMode === "auto";
  const receipts: PromotionReceipt[] = [];
  for (const output of workCodeOutputs(input.parts)) {
    const parsed = parseWorkCodeOutput(output);
    if (!parsed?.ok || !parsed.suggestedRecipe) continue;
    const candidate = parsed.reusableToolCandidate as ReusableToolCandidate | undefined;
    if (!candidate || !candidate.eligible) continue;
    const raw = parsed.suggestedRecipe as Record<string, unknown>;
    const capabilities = Array.isArray(raw.capabilities) ? raw.capabilities.map(String) : [];
    const decision = recipeApprovalDecision({
      autoTrust: autoEnable,
      capabilities,
      portable: typeof raw.portable === "boolean" ? raw.portable : undefined,
    });
    if (!shouldPersistSuggestedRecipe(decision)) continue;
    const status = autoEnable ? "enabled" as const : "pending" as const;
    let recipe: PromotedRecipe;
    try {
      recipe = await deps.createRecipe({
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name : `WorkCodeRecipe_${deps.now()}`,
        description: typeof raw.description === "string" ? raw.description : "Promoted from a successful work_code run.",
        inputSchema: raw.inputSchema && typeof raw.inputSchema === "object" ? raw.inputSchema : { type: "object", properties: {} },
        code: typeof raw.code === "string" ? raw.code : "return null;",
        capabilities,
        sourceRunId,
        status,
      });
    } catch (error) {
      if (!(error instanceof SavedRecipeError)) throw error;
      deps.logError("recipe_promotion_skipped", {
        sessionId: sourceRunId,
        fingerprint: candidate.fingerprint,
        code: error.code,
        err: error.message,
      });
      receipts.push({ ok: false, fingerprint: candidate.fingerprint, reason: error.code, error: error.message });
      continue;
    }
    if (recipe.status === "enabled") {
      await deps.projectEnabledRecipe(recipe.id).catch((error) => deps.logError("cm_snippet_projection_failed", {
        recipeId: recipe.id,
        err: error instanceof Error ? error.message : String(error),
      }));
    }
    receipts.push({ id: recipe.id, name: recipe.name, status: recipe.status, trustMode, fingerprint: candidate.fingerprint });
    if (decision.notify) {
      await deps.notifyOwner({
        kind: "recipe.approval",
        title: `Review reusable tool: ${recipe.name}`,
        body: `${recipe.description} Review its source and capabilities, then approve it if you want My AX to reuse it.`,
        href: reusableToolReviewHref(recipe.name),
      }).catch((error) => deps.logError("recipe_approval_attention_failed", { sessionId: sourceRunId, err: String(error) }));
    }
  }
  return receipts;
}
