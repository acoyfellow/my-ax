import { SCHEDULED_JOB_RUN_PREFIX } from "./jobs";

export function deriveSessionTitle(content: string): string {
  const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, "");
  const withoutScheduledJobFrame = withoutCodeBlocks.startsWith(SCHEDULED_JOB_RUN_PREFIX)
    ? withoutCodeBlocks.slice(SCHEDULED_JOB_RUN_PREFIX.length)
    : withoutCodeBlocks;
  const cleaned = withoutScheduledJobFrame.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Untitled session";
  // Preserve a useful server-side title. The sidebar owns visual truncation
  // based on its actual available width; do not bake an early ellipsis into
  // persisted conversation data.
  // Truncate by Unicode code points, not UTF-16 code units, so a supplementary
  // character (e.g. an emoji) straddling the 200 boundary is never split into a
  // lone surrogate that renders as �.
  return Array.from(cleaned).slice(0, 200).join("");
}
