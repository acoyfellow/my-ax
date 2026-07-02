export function stripReasoningArtifacts(content: string): string {
  let sanitized = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const close = sanitized.toLowerCase().lastIndexOf("</think>");
  if (close !== -1) {
    const before = sanitized.slice(0, close);
    const after = sanitized.slice(close + "</think>".length);
    const leakStart = before.search(/\n\n(?:Need|I need|Let's|Since|The instruction|This is a recurring job)\b/);
    sanitized = (leakStart === -1 ? before : before.slice(0, leakStart)) + after;
  }
  return sanitized.replace(/<\/?think>/gi, "").trim();
}

export function visibleAssistantContent(input: { status: string; content: string; error?: string | null; ownerNotified?: boolean }): string {
  const content = stripReasoningArtifacts(input.content);
  if (content.trim()) return content;
  if (input.status === "error" && input.error?.trim()) return input.error;
  if (input.status === "completed" && input.ownerNotified) {
    return "The agent turn completed after sending an owner notification. Review the notification or conversation for the result.";
  }
  if (input.status === "completed") {
    return "The agent turn completed without a visible response. Review the conversation and retry or steer with a more explicit instruction.";
  }
  return input.error || "";
}

export function visibleCompletionNotificationBody(content: string): string {
  return content.trim() || "The agent turn completed without a visible response.";
}
