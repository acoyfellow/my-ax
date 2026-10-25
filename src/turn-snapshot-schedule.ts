import { TURN_SNAPSHOT_COOLDOWN_MS } from "./workspace-policy";

export const TURN_SNAPSHOT_CALLBACK = "snapshotWorkspaceAfterTurn";
export const BACKUP_RETRY_CALLBACK = "retryWorkspaceBackupAfterCooldown";

export type IdempotentSchedule = (delaySeconds: number, callback: string, payload: undefined, options: { idempotent: true }) => Promise<unknown>;

export function scheduleTurnSnapshot(schedule: IdempotentSchedule): Promise<unknown> {
  return schedule(0, TURN_SNAPSHOT_CALLBACK, undefined, { idempotent: true });
}

export function scheduleBackupRetry(schedule: IdempotentSchedule): Promise<unknown> {
  return schedule(Math.ceil(TURN_SNAPSHOT_COOLDOWN_MS / 1000), BACKUP_RETRY_CALLBACK, undefined, { idempotent: true });
}
