const DECISION_ID_RE = /^run-decision-[0-9a-f-]{36}$/i;
const MAX_OPTIONS = 4;
const MAX_OPTION_CHARS = 200;

export type DecisionReceipt = { kind: "decision"; decisionId: string; options: string[] };

export type DecisionView =
  | { phase: "loading" }
  | { phase: "open"; question: string; options: string[] }
  | { phase: "sending"; question: string; options: string[]; choice: string }
  | { phase: "answered"; question: string; options: string[]; choice: string | null; answeredAt: string | null }
  | { phase: "replaced"; question: string; replacedBy: string | null }
  | { phase: "dismissed"; question: string }
  | { phase: "error"; message: string; question: string | null; options: string[] };

export type DecisionStatePayload = {
  question: string;
  options: string[];
  state: "open" | "answered" | "replaced" | "dismissed";
  choice: string | null;
  answeredAt: string | null;
  replacedBy: string | null;
};

function parsed(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const json = JSON.parse(value);
    return json && typeof json === "object" ? json as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function decisionReceipt(value: unknown, toolName: string): DecisionReceipt | null {
  if (toolName !== "ask_user") return null;
  const body = parsed(value);
  if (!body || body.ok !== true || typeof body.decisionId !== "string" || !DECISION_ID_RE.test(body.decisionId)) return null;
  const options = Array.isArray(body.options)
    ? body.options.filter((option): option is string => typeof option === "string").slice(0, MAX_OPTIONS).map((option) => option.slice(0, MAX_OPTION_CHARS))
    : [];
  return { kind: "decision", decisionId: body.decisionId, options };
}

export function viewFromState(state: DecisionStatePayload): DecisionView {
  if (state.state === "open") return { phase: "open", question: state.question, options: state.options };
  if (state.state === "dismissed") return { phase: "dismissed", question: state.question };
  if (state.state === "replaced") return { phase: "replaced", question: state.question, replacedBy: state.replacedBy };
  return { phase: "answered", question: state.question, options: state.options, choice: state.choice, answeredAt: state.answeredAt };
}

export function viewAfterAnswer(view: DecisionView, choice: string, status: number, message: string | null): DecisionView {
  const question = "question" in view ? view.question ?? "" : "";
  const options = "options" in view ? view.options : [];
  if (status >= 200 && status < 300) return { phase: "answered", question, options, choice, answeredAt: new Date().toISOString() };
  if (status === 409) return { phase: "answered", question, options, choice: null, answeredAt: null };
  return { phase: "error", message: message ?? "Your choice was not recorded. Try again.", question, options };
}

export function decisionIdFromLocation(href: string): string | null {
  try {
    const id = new URL(href).searchParams.get("decision");
    return id && DECISION_ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function canDismiss(view: DecisionView): boolean {
  return view.phase === "open" || view.phase === "error";
}

export function viewAfterDismiss(view: DecisionView, status: number): DecisionView {
  const question = "question" in view ? view.question ?? "" : "";
  if (status >= 200 && status < 300) return { phase: "dismissed", question };
  return view;
}

export type DecisionFetch = (input: string, init: RequestInit) => Promise<{ status: number }>;

export async function dismissDecisionOnServer(decisionId: string, send: DecisionFetch): Promise<number> {
  if (!DECISION_ID_RE.test(decisionId)) return 400;
  try {
    return (await send(`/api/decisions/${encodeURIComponent(decisionId)}/dismiss`, { method: "POST", credentials: "include" })).status;
  } catch {
    return 0;
  }
}
