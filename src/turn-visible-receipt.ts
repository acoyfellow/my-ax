export function stripReasoningArtifacts(content: string): string {
  let sanitized = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // A truncated generation can leave an unmatched opening <think> with no close.
  // Drop everything from that dangling tag onward so hidden scratchpad reasoning
  // never leaks into the visible receipt.
  const danglingOpen = sanitized.toLowerCase().indexOf("<think>");
  if (danglingOpen !== -1) sanitized = sanitized.slice(0, danglingOpen);
  const close = sanitized.toLowerCase().lastIndexOf("</think>");
  if (close !== -1) {
    const before = sanitized.slice(0, close);
    const after = sanitized.slice(close + "</think>".length);
    const leakStart = before.search(/\n\n(?:Need|I need|Let's|Since|The instruction|This is a recurring job)\b/);
    sanitized = (leakStart === -1 ? before : before.slice(0, leakStart)) + after;
  }
  sanitized = sanitized.replace(/<\/?think>/gi, "").trim();
  const leadingScratchpad = /^(?:I need|Let me|I'll|I should|Need|The user wants me to|The prompt says)\b/i;
  const doneAfterScratchpad = sanitized.search(/\bDone[.!:]/);
  if (doneAfterScratchpad > 0 && leadingScratchpad.test(sanitized.slice(0, doneAfterScratchpad).trim())) {
    sanitized = sanitized.slice(doneAfterScratchpad).trim();
  }

  const statusMatch = sanitized.match(/(?:Lee cmux[^.\n]{0,120}?status ping|Lee \(|Notification sent|Status ping|Summary captured|Check complete)\b/i);
  const statusAfterScratchpad = statusMatch?.index ?? -1;
  if (statusAfterScratchpad > 0 && statusAfterScratchpad < 280 && leadingScratchpad.test(sanitized.slice(0, statusAfterScratchpad).trim())) {
    sanitized = sanitized.slice(statusAfterScratchpad).trim();
  }
  return sanitized;
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

export function shouldSendCompletionNotification(input: { status: string; hasVisibleChat: boolean; ownerNotified: boolean; automaticRecovery?: boolean }): boolean {
  return input.status === "completed" && !input.hasVisibleChat && !input.ownerNotified && !input.automaticRecovery;
}
