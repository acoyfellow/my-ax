import { SCHEDULED_JOB_RUN_PREFIX } from "./jobs";
import { MAX_GENERATED_SESSION_TITLE_CODE_POINTS, truncateUnicodeCodePoints } from "./unicode-text";

export function isScheduledJobRunMessage(content: string): boolean {
  return content.startsWith(SCHEDULED_JOB_RUN_PREFIX);
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
