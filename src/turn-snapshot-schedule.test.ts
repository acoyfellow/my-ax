import { test } from "node:test";
import assert from "node:assert/strict";

type Row = { time: number; callback: string };

function idempotentScheduler(nowSeconds: () => number) {
  const rows: Row[] = [];
  const schedule = async (delaySeconds: number, callback: string) => {
    if (rows.some((row) => row.callback === callback)) return { created: false };
    rows.push({ time: nowSeconds() + delaySeconds, callback });
    return { created: true };
  };
  const runDue = (now: number) => {
    const due = rows.filter((row) => row.time <= now);
    for (const row of due) rows.splice(rows.indexOf(row), 1);
    return due.map((row) => row.callback);
  };
  return { rows, schedule, runDue };
}

test("a turn that ends while a backup retry is pending still gets its disk snapshot right away", async () => {
  const { scheduleTurnSnapshot, scheduleBackupRetry, TURN_SNAPSHOT_CALLBACK } = await import("./turn-snapshot-schedule");
  let now = 1000;
  const scheduler = idempotentScheduler(() => now);
  await scheduleTurnSnapshot(scheduler.schedule);
  assert.deepEqual(scheduler.runDue(now), [TURN_SNAPSHOT_CALLBACK]);
  await scheduleBackupRetry(scheduler.schedule);
  now += 30;
  await scheduleTurnSnapshot(scheduler.schedule);
  assert.deepEqual(scheduler.runDue(now), [TURN_SNAPSHOT_CALLBACK]);
});

test("the backup retry and the per-turn snapshot use different callbacks", async () => {
  const { TURN_SNAPSHOT_CALLBACK, BACKUP_RETRY_CALLBACK } = await import("./turn-snapshot-schedule");
  assert.notEqual(TURN_SNAPSHOT_CALLBACK, BACKUP_RETRY_CALLBACK);
});

test("both chat engines expose the backup retry callback", async () => {
  const fs = await import("node:fs/promises");
  const pi = await fs.readFile(new URL("./pi-engine/pi-chat-agent.ts", import.meta.url), "utf8");
  const think = await fs.readFile(new URL("./agent.ts", import.meta.url), "utf8");
  for (const source of [pi, think]) {
    assert.match(source, /async retryWorkspaceBackupAfterCooldown\(/);
    assert.doesNotMatch(source, /schedule\(Math\.ceil\(TURN_SNAPSHOT_COOLDOWN_MS \/ 1000\), "snapshotWorkspaceAfterTurn"/);
  }
});
