import assert from "node:assert/strict";
import test from "node:test";
import { ASK_USER_TOOL, DESK_UPSERT_TOOL, deskCardForCurrentSession } from "./tools";
import type { Env, ToolContext } from "./types";

type DecisionRow = {
  id: string;
  ownerEmail: string;
  sessionId: string;
  taskSummary: string;
  status: "open";
};

function decisionStore() {
  const decisions: DecisionRow[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async first<T>() {
                if (!sql.startsWith("SELECT id FROM runs")) throw new Error(`Unexpected query: ${sql}`);
                const [ownerEmail, sessionId, taskSummary] = values as [string, string, string];
                const decision = decisions.find((row) => row.ownerEmail === ownerEmail && row.sessionId === sessionId && row.taskSummary === taskSummary && row.status === "open");
                return (decision ? { id: decision.id } : null) as T | null;
              },
              async run() {
                if (!sql.startsWith("INSERT INTO runs")) throw new Error(`Unexpected query: ${sql}`);
                const [id, ownerEmail, sessionId, _title, taskSummary] = values as [string, string, string, string, string];
                decisions.push({ id, ownerEmail, sessionId, taskSummary, status: "open" });
                return { meta: { changes: 1 } };
              },
            };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, decisions };
}

test("desk_upsert binds an answerable card to the writing conversation", () => {
  const card = deskCardForCurrentSession({
    id: "release",
    title: "Choose a target",
    originSessionId: "forged-session",
    reply: { label: "Send", prompt: "Where should I deploy?" },
  }, "actual-session");
  assert.equal(card.originSessionId, "actual-session");

  const report = deskCardForCurrentSession({
    id: "report",
    title: "Everything is healthy",
    originSessionId: "forged-session",
  }, "actual-session");
  assert.equal("originSessionId" in report, false);
});

test("desk_upsert advertises status reports and answerable cards", () => {
  const properties = (DESK_UPSERT_TOOL.parameters.properties ?? {}) as Record<string, Record<string, unknown>>;
  assert.equal(properties.status?.enum, undefined);
  assert.equal(properties.agent?.type, "string");
  assert.equal(properties.reply?.type, "object");
  assert.equal(properties.actionHref?.type, "string");
});

test("ask_user sends one owner notification when a retried decision is reused", async () => {
  const { env, decisions } = decisionStore();
  const notifications: Array<{ kind: string; href?: string }> = [];
  const context = {
    env,
    identity: { email: "OWNER@example.com" },
    sessionId: "session-1",
    async notifyOwner(input: { kind: string; href?: string }) {
      notifications.push(input);
      return { delivered: 1, expired: 0, failed: 0, devices: 1 };
    },
  } as unknown as ToolContext;
  const input = { question: "Choose a deployment?", options: ["Blue", "Green"] };

  const first = JSON.parse(await ASK_USER_TOOL.execute(input, context));
  const second = JSON.parse(await ASK_USER_TOOL.execute(input, context));

  assert.equal(first.ok, true);
  assert.equal(first.awaiting, true);
  assert.equal(second.ok, true);
  assert.equal(second.awaiting, true);
  assert.equal(second.decisionId, first.decisionId);
  assert.equal(second.href, first.href);
  assert.equal(decisions.length, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].kind, "job.needs_input");
  assert.equal(notifications[0].href, first.href);
});
