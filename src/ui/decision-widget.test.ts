import assert from "node:assert/strict";
import { test } from "node:test";
import { canDismiss, decisionIdFromLocation, decisionReceipt, dismissDecisionOnServer, viewAfterAnswer, viewAfterDismiss, viewFromState, type DecisionView } from "./decision-widget";
import { resolveToolResultWidget } from "./tool-result-widgets";

const ID = "run-decision-11111111-1111-4111-8111-111111111111";
const result = JSON.stringify({ ok: true, awaiting: true, decisionId: ID, href: `/?session=s&decision=${ID}`, options: ["Yes", "No"] });

test("an ask_user result becomes an inline decision widget", () => {
  assert.deepEqual(decisionReceipt(result, "ask_user"), { kind: "decision", decisionId: ID, options: ["Yes", "No"] });
  assert.deepEqual(resolveToolResultWidget(result, "ask_user"), { kind: "decision", decisionId: ID, options: ["Yes", "No"] });
});

test("other tools, failed asks and bad ids stay raw", () => {
  assert.equal(decisionReceipt(result, "workspace_exec"), null);
  assert.equal(decisionReceipt(JSON.stringify({ ok: false, error: "question is required" }), "ask_user"), null);
  assert.equal(decisionReceipt(JSON.stringify({ ok: true, decisionId: "../../etc", options: [] }), "ask_user"), null);
  assert.equal(resolveToolResultWidget(JSON.stringify({ ok: false }), "ask_user").kind, "raw-text");
});

test("server state maps to a frozen view", () => {
  const base = { question: "Ship?", options: ["Yes", "No"], choice: null, answeredAt: null, replacedBy: null };
  assert.deepEqual(viewFromState({ ...base, state: "open" }), { phase: "open", question: "Ship?", options: ["Yes", "No"] });
  assert.deepEqual(viewFromState({ ...base, state: "answered", choice: "No", answeredAt: "t" }), { phase: "answered", question: "Ship?", options: ["Yes", "No"], choice: "No", answeredAt: "t" });
  assert.deepEqual(viewFromState({ ...base, state: "replaced", replacedBy: ID }), { phase: "replaced", question: "Ship?", replacedBy: ID });
});

test("an answer freezes the widget; a conflict freezes it as already answered; a failure stays answerable", () => {
  const open = { phase: "open" as const, question: "Ship?", options: ["Yes", "No"] };
  const answered = viewAfterAnswer(open, "Yes", 200, null);
  assert.equal(answered.phase, "answered");
  assert.equal(answered.phase === "answered" && answered.choice, "Yes");
  assert.deepEqual(viewAfterAnswer(open, "Yes", 409, null), { phase: "answered", question: "Ship?", options: ["Yes", "No"], choice: null, answeredAt: null });
  assert.deepEqual(viewAfterAnswer(open, "Yes", 503, "down"), { phase: "error", message: "down", question: "Ship?", options: ["Yes", "No"] });
});

test("focus waits for the widget to render, then scrolls and announces once", async () => {
  const { focusDecision } = await import("./decision-focus");
  const scrolled: unknown[] = [];
  const announced: string[] = [];
  const element = { scrollIntoView: (options: unknown) => scrolled.push(options), classList: { remove() {}, add() {} }, offsetWidth: 1 } as unknown as HTMLElement;
  let calls = 0;
  const found = await focusDecision(ID, { find: () => (++calls >= 3 ? element : null), wait: async () => {}, announce: (id) => announced.push(id) });
  assert.equal(found, true);
  assert.equal(calls, 3);
  assert.deepEqual(scrolled, [{ block: "center", behavior: "smooth" }]);
  assert.deepEqual(announced, [ID]);
  assert.equal(await focusDecision(ID, { find: () => null, wait: async () => {}, announce: () => announced.push("x") }, 3), false);
  assert.deepEqual(announced, [ID]);
});

test("the thread link names which decision to scroll to", () => {
  assert.equal(decisionIdFromLocation(`https://my.ax/?session=s&decision=${ID}`), ID);
  assert.equal(decisionIdFromLocation("https://my.ax/?session=s&decision=<script>"), null);
  assert.equal(decisionIdFromLocation("https://my.ax/?session=s"), null);
});

test("a dismissed decision renders closed on reload, with no buttons to answer", () => {
  const view = viewFromState({ question: "Q?", options: ["A", "B"], state: "dismissed", choice: null, answeredAt: "2026-11-23T00:00:00Z", replacedBy: null });
  assert.deepEqual(view, { phase: "dismissed", question: "Q?" });
  assert.equal(canDismiss(view), false);
});

test("the X is offered only while the decision is open or failed to send", () => {
  assert.equal(canDismiss({ phase: "open", question: "Q", options: ["A"] }), true);
  assert.equal(canDismiss({ phase: "error", message: "x", question: "Q", options: ["A"] }), true);
  assert.equal(canDismiss({ phase: "sending", question: "Q", options: ["A"], choice: "A" }), false);
  assert.equal(canDismiss({ phase: "answered", question: "Q", options: ["A"], choice: "A", answeredAt: null }), false);
});

test("a dismiss that the server refused keeps the widget as it was", () => {
  const open: DecisionView = { phase: "open", question: "Q", options: ["A"] };
  assert.deepEqual(viewAfterDismiss(open, 200), { phase: "dismissed", question: "Q" });
  assert.deepEqual(viewAfterDismiss(open, 0), open);
  assert.deepEqual(viewAfterDismiss(open, 404), open);
});

test("the client dismiss call posts with credentials and refuses a malformed id", async () => {
  const calls: Array<{ input: string; init: RequestInit }> = [];
  const send = async (input: string, init: RequestInit) => { calls.push({ input, init }); return { status: 200 }; };
  assert.equal(await dismissDecisionOnServer(ID, send), 200);
  assert.equal(calls[0].input, `/api/decisions/${ID}/dismiss`);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "include");
  assert.equal(await dismissDecisionOnServer("../sessions", send), 400);
  assert.equal(calls.length, 1);
  assert.equal(await dismissDecisionOnServer(ID, async () => { throw new Error("offline"); }), 0);
});
