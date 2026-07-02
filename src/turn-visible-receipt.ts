export function visibleAssistantContent(input: { status: string; content: string; error?: string | null }): string {
  if (input.content.trim()) return input.content;
  if (input.status === "error" && input.error?.trim()) return input.error;
  if (input.status === "completed") {
    return "The agent turn completed without a visible response. Review the conversation and retry or steer with a more explicit instruction.";
  }
  return input.error || "";
}

export function visibleCompletionNotificationBody(content: string): string {
  return content.trim() || "The agent turn completed without a visible response.";
}
