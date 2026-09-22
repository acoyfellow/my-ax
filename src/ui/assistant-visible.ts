export type VisibleAssistantPart = { kind: string; text?: string };

export function assistantTurnHasVisibleOutput(message: {
  content?: string;
  parts?: VisibleAssistantPart[];
} | undefined): boolean {
  if (!message) return false;
  if ((message.content ?? "").trim().length > 0) return true;
  return (message.parts ?? []).some((part) =>
    (part.kind === "text" && (part.text ?? "").trim().length > 0) ||
    part.kind === "tool" ||
    part.kind === "svelte-artifact" ||
    part.kind === "named-computer",
  );
}

export function shouldReportInvisibleCompletion(_hasVisibleOutput: boolean): boolean {
  return false;
}
