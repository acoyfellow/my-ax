import * as workers from "cloudflare:workers";

export type IssueContext = {
  userId?: string;
  sessionId?: string;
  model?: string;
};

type AttributeSink = { setAttribute(key: string, value: string): unknown };

export function issueAttributes(context: IssueContext): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (context.userId) attributes["user.id"] = context.userId;
  if (context.sessionId) attributes["session.id"] = context.sessionId;
  if (context.model) attributes["ai.model"] = context.model;
  return attributes;
}

export function applyIssueContext(context: IssueContext, span: AttributeSink | undefined = activeSpan()): void {
  if (!span) return;
  for (const [key, value] of Object.entries(issueAttributes(context))) span.setAttribute(key, value);
}

function activeSpan(): AttributeSink | undefined {
  try {
    const tracing = (workers as { tracing?: { getActiveSpan?: () => AttributeSink | undefined } }).tracing;
    return tracing?.getActiveSpan?.();
  } catch {
    return undefined;
  }
}
