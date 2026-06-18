import assert from "node:assert/strict";
import test from "node:test";
import { publishWorkspaceSnapshot, type WorkspaceSnapshotPointer } from "./workspace-snapshot";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeDb(initialVersion?: number) {
  let row: { id: string; dir: string; version: number } | undefined = initialVersion === undefined
    ? undefined
    : { id: "legacy", dir: "/home/user", version: initialVersion };
  const db = {
    prepare(sql: string) {
      assert.match(sql, /snapshot_version=workspace_snapshots\.snapshot_version \+ 1/);
      assert.doesNotMatch(sql, /Date\.now|random|WHERE workspace_snapshots\.snapshot_version/);
      return {
        bind(_owner: string, id: string, dir: string) {
          return { async run() { row = { id, dir, version: row ? row.version + 1 : 1 }; } };
        },
      };
    },
  } as unknown as D1Database;
  return { db, row: () => row };
}

const backup = (id: string): WorkspaceSnapshotPointer => ({ id, dir: "/home/user" });

for (const [label, startedAt] of [["same millisecond", [1000, 1000]], ["one millisecond apart", [1000, 1001]]] as const) {
  test(`completed publication order wins when invocations start ${label}`, async () => {
    const store = fakeDb();
    const olderInvocation = deferred<WorkspaceSnapshotPointer>();
    const newerInvocation = deferred<WorkspaceSnapshotPointer>();

    // startedAt documents the controlled clock values that formerly generated
    // versions; publication intentionally does not consume either value.
    assert.deepEqual(startedAt, label === "same millisecond" ? [1000, 1000] : [1000, 1001]);
    const publishAfterCompletion = async (completion: Promise<WorkspaceSnapshotPointer>) =>
      publishWorkspaceSnapshot(store.db, "owner@example.com", await completion);
    const older = publishAfterCompletion(olderInvocation.promise);
    const newer = publishAfterCompletion(newerInvocation.promise);

    newerInvocation.resolve(backup("newer-invocation"));
    await newer;
    olderInvocation.resolve(backup("older-invocation-delayed"));
    await older;

    assert.deepEqual(store.row(), { id: "older-invocation-delayed", dir: "/home/user", version: 2 });
  });
}

test("migration-default generation zero advances on first publication", async () => {
  const store = fakeDb(0);
  await publishWorkspaceSnapshot(store.db, "owner@example.com", backup("first"));
  assert.equal(store.row()?.version, 1);
});
