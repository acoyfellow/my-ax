import assert from "node:assert/strict";
import test from "node:test";
import { notifyOwner } from "./notify";

test("five automated notifications reuse one stable owner session", async () => {
  let sessionId: string | undefined;
  let inserts = 0;
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes("stable_name")) return (sessionId ? { id: sessionId } : null) as T | null;
              return null;
            },
            async all<T>() { return { results: [] as T[] }; },
            async run() {
              if (sql.includes("stable_name")) { sessionId = String(values[0]); inserts += 1; }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  const env = { DB: db, BRIDGE_BASE_URL: "https://my.ax.example" } as any;
  for (let i = 0; i < 5; i += 1) {
    await notifyOwner(env, "Owner@Example.com", { kind: "session.update", title: `Update ${i}`, body: "done", stableName: "Owner notifications" });
  }
  assert.ok(sessionId);
  assert.equal(inserts, 1);
});
