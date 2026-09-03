import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { emptyDeskBoard, upsertDeskCard, type DeskBoard } from "../desk-board";
import { registerDeskRoutes } from "./desk";

type StoredBoard = { valueJson: string; version: string };

function boardKey(email: string): string {
  return `${email}|desk.board`;
}

function makeDeskApp() {
  const boards = new Map<string, StoredBoard>();
  const ownerNames: string[] = [];
  const broadcasts: Array<{ sessionIds: string[]; board: DeskBoard }> = [];
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { values = next; return statement; },
        async first<T = unknown>() {
          if (sql.includes("FROM owner_preferences")) {
            const stored = boards.get(boardKey(String(values[0])));
            return (stored ? { value_json: stored.valueJson, updated_at: stored.version } : null) as T;
          }
          return null as T;
        },
        async all<T = unknown>() {
          if (sql.includes("FROM sessions")) return { results: [{ id: "session-a" }, { id: "session-b" }] } as T;
          return { results: [] } as T;
        },
        async run() {
          const email = String(values[0]);
          const key = boardKey(email);
          if (sql.includes("ON CONFLICT(owner_email, preference_key) DO NOTHING")) {
            if (boards.has(key)) return { meta: { changes: 0 } };
            boards.set(key, { valueJson: String(values[2]), version: String(values[4]) });
            return { meta: { changes: 1 } };
          }
          if (sql.includes("UPDATE owner_preferences SET value_json")) {
            const current = boards.get(boardKey(String(values[2])));
            if (!current || current.version !== values[4]) return { meta: { changes: 0 } };
            boards.set(boardKey(String(values[2])), { valueJson: String(values[0]), version: String(values[1]) });
            return { meta: { changes: 1 } };
          }
          throw new Error(`unexpected query: ${sql}`);
        },
      };
      return statement;
    },
  };
  const USER_AGENT = {
    idFromName(name: string) { ownerNames.push(name); return name; },
    get() {
      return {
        async setName() {},
        async broadcastDeskBoard(sessionIds: string[], board: DeskBoard) { broadcasts.push({ sessionIds, board }); },
      };
    },
  };
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("identity", { email: c.req.header("X-Test-Identity") ?? "", sub: "test-owner" });
    await next();
  });
  registerDeskRoutes(app);
  const env = { DB, USER_AGENT } as unknown as AppEnv["Bindings"];
  return { app, boards, ownerNames, broadcasts, env };
}

test("DELETE /api/desk/:cardId removes only the authenticated owner's requested card", async () => {
  const { app, boards, ownerNames, broadcasts, env } = makeDeskApp();
  const otherBoard = upsertDeskCard(emptyDeskBoard("other-0"), { id: "middle", title: "Other owner's card" }, "other-1");
  boards.set(boardKey("other@example.com"), { valueJson: JSON.stringify(otherBoard), version: "other-1" });

  for (const card of [
    { id: "first", title: "First", body: "unchanged" },
    { id: "middle", title: "Middle", href: "https://github.com/acoyfellow/my-ax/issues/157" },
    { id: "last", title: "Last", status: "approved" },
  ]) {
    const response = await app.fetch(new Request("https://my-ax.test/api/desk", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Identity": "Owner@Example.com" },
      body: JSON.stringify(card),
    }), env);
    assert.equal(response.status, 200);
  }

  const response = await app.fetch(new Request("https://my-ax.test/api/desk/middle", {
    method: "DELETE",
    headers: { "X-Test-Identity": "Owner@Example.com" },
  }), env);
  assert.equal(response.status, 200);
  const body = await response.json() as { result: DeskBoard };

  assert.deepEqual(body.result.cards.map((card) => card.id), ["last", "first"]);
  assert.deepEqual(body.result.cards.map(({ id, title, body: cardBody, status }) => ({ id, title, body: cardBody, status })), [
    { id: "last", title: "Last", body: "", status: "approved" },
    { id: "first", title: "First", body: "unchanged", status: "pending" },
  ]);
  assert.deepEqual(JSON.parse(boards.get(boardKey("other@example.com"))!.valueJson), otherBoard);
  assert.ok(ownerNames.every((name) => name === "owner@example.com"));
  assert.equal(broadcasts.length, 4);
  assert.deepEqual(broadcasts.at(-1), { sessionIds: ["session-a", "session-b"], board: body.result });
});

test("DELETE /api/desk/:cardId rejects invalid ids before mutating the board", async () => {
  const { app, boards, env } = makeDeskApp();
  const board = upsertDeskCard(emptyDeskBoard("t0"), { id: "keep", title: "Keep" }, "t1");
  boards.set(boardKey("owner@example.com"), { valueJson: JSON.stringify(board), version: "t1" });

  const response = await app.fetch(new Request("https://my-ax.test/api/desk/%20", {
    method: "DELETE",
    headers: { "X-Test-Identity": "Owner@Example.com" },
  }), env);

  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(boards.get(boardKey("owner@example.com"))!.valueJson), board);
});
