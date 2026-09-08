export type ReusableToolApprovalMode = "review" | "auto";

export const APPROVAL_MODE_KEY = "reusable_tools.approval_mode";

export function reusableToolOwnerEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function parseApprovalMode(value: unknown): ReusableToolApprovalMode | null {
  if (value === "review" || value === "auto") return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as { approvalMode?: unknown };
    return parsed.approvalMode === "review" || parsed.approvalMode === "auto" ? parsed.approvalMode : null;
  } catch {
    return null;
  }
}
