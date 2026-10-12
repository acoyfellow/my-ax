import assert from "node:assert/strict";
import { test } from "node:test";
import { clampMinutes, recentObserveEvents, recordObserveEvent } from "./observe-events";

function fakeDb() {
  const rows: Array<Record<string, unknown>> = [];
  return {
    rows,
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              if (sql.startsWith("INSERT")) rows.push({ owner_email: values[0], session_id: values[1], ts: values[2], kind: values[3], name: values[4], duration_ms: values[5], outcome: values[6], message: values[7] });
              return {};
            },
            async all<T>() {
              const [owner, since, kind, , session] = values as [string, string, string | null, unknown, string | null];
              return { results: rows.filter((row) => row.owner_email === owner && String(row.ts) >= since && (kind === null || row.kind === kind) && (session === null || row.session_id === session)).reverse() as T[] };
            },
          };
        },
      };
    },
  };
}

test("step and workspace events are stored per owner and read back filtered by kind and session", async () => {
  const db = fakeDb();
  await recordObserveEvent(db, { ownerEmail: "A@x.com", sessionId: "s1", kind: "step", name: "tool-calls", durationMs: 1200, outcome: "ok" });
  await recordObserveEvent(db, { ownerEmail: "a@x.com", sessionId: "s1", kind: "workspace", name: "restore", durationMs: 900, outcome: "error", message: "x".repeat(900) });
  await recordObserveEvent(db, { ownerEmail: "b@x.com", sessionId: "s2", kind: "step", name: "stop" });
  const workspace = await recentObserveEvents(db, "a@x.com", { kind: "workspace" });
  assert.deepEqual(workspace.map((row) => [row.name, row.outcome]), [["restore", "error"]]);
  assert.equal(String(workspace[0].message).length, 500);
  assert.equal((await recentObserveEvents(db, "a@x.com", { sessionId: "s1" })).length, 2);
  assert.equal((await recentObserveEvents(db, "b@x.com", {})).length, 1);
});

test("the lookback window is bounded by retention", () => {
  assert.equal(clampMinutes(undefined), 60);
  assert.equal(clampMinutes(10_000_000), 7 * 1440);
});
