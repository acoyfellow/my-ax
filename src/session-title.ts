import { isScheduledJobRunMessage, SCHEDULED_JOB_RUN_PREFIX } from "./jobs-prompt";
import { MAX_GENERATED_SESSION_TITLE_CODE_POINTS, truncateUnicodeCodePoints } from "./unicode-text";

export { isScheduledJobRunMessage };

export function issueSessionTitle(number: number, title: string): string {
  const cleaned = title.replace(/\s+/g, " ").trim() || "untitled";
  return truncateUnicodeCodePoints(`Issue #${number}: ${cleaned}`, MAX_GENERATED_SESSION_TITLE_CODE_POINTS);
}

export function deriveSessionTitle(content: string): string {
  const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, "");
  const withoutScheduledJobFrame = isScheduledJobRunMessage(withoutCodeBlocks)
    ? withoutCodeBlocks.slice(SCHEDULED_JOB_RUN_PREFIX.length)
    : withoutCodeBlocks;
  const cleaned = withoutScheduledJobFrame.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Untitled session";
  return truncateUnicodeCodePoints(cleaned, MAX_GENERATED_SESSION_TITLE_CODE_POINTS);
}
