import { autoTrustMode } from "./auto-trust";
import type { Env } from "./types";

export type ReusableToolApprovalMode = "review" | "auto";

const APPROVAL_MODE_KEY = "reusable_tools.approval_mode";

function ownerEmail(value: string): string {
  return value.trim().toLowerCase();
}

function parseApprovalMode(value: unknown): ReusableToolApprovalMode | null {
  if (value === "review" || value === "auto") return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as { approvalMode?: unknown };
    return parsed.approvalMode === "review" || parsed.approvalMode === "auto" ? parsed.approvalMode : null;
  } catch {
    return null;
  }
}

/**
 * Read the owner-visible approval mode. A stored choice wins over the legacy
 * deploy variable so an owner can turn auto-enable back off from Settings.
 * Before migration 0017 is applied, preserve the deploy-level fallback.
 */
export async function reusableToolApprovalMode(env: Env, email: string): Promise<ReusableToolApprovalMode> {
  try {
    const row = await env.DB.prepare(
      "SELECT value_json FROM owner_preferences WHERE owner_email = ? AND preference_key = ?",
    ).bind(ownerEmail(email), APPROVAL_MODE_KEY).first<{ value_json: string }>();
    const stored = parseApprovalMode(row?.value_json);
    if (stored) return stored;
  } catch (error) {
    if (!String(error).includes("no such table")) throw error;
  }
  return autoTrustMode(env) === "auto" ? "auto" : "review";
}

export async function setReusableToolApprovalMode(
  env: Env,
  email: string,
  approvalMode: ReusableToolApprovalMode,
): Promise<ReusableToolApprovalMode> {
  if (approvalMode !== "review" && approvalMode !== "auto") throw new Error("approvalMode must be review or auto");
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO owner_preferences (owner_email, preference_key, value_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(owner_email, preference_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).bind(ownerEmail(email), APPROVAL_MODE_KEY, JSON.stringify({ approvalMode }), now, now).run();
  return approvalMode;
}
