export const REBUILDABLE_BACKUP_EXCLUDES = [
  ".cache",
  "*.log",
  "node_modules",
  ".npm",
  ".pnpm-store",
  ".yarn/cache",
  ".bun/install/cache",
  ".wrangler/tmp",
  ".next",
  ".svelte-kit",
  ".turbo",
  "dist",
  "build/.cache",
  "target/debug",
  "__pycache__",
  ".venv",
] as const;

export const TURN_SNAPSHOT_COOLDOWN_MS = 5 * 60 * 1000;

const SHRINK_GUARD_MIN_PREVIOUS_BYTES = 10 * 1024 * 1024;
const SHRINK_GUARD_RATIO = 0.1;

export type WorkspaceScope = { kind: "owner" } | { kind: "chat"; chatId: string };

export function workspaceSandboxId(ownerEmail: string, scope: WorkspaceScope): string {
  const owner = ownerEmail.toLowerCase();
  if (scope.kind === "owner") return owner;
  return `${owner}#chat:${scope.chatId.toLowerCase()}`;
}

export function workspaceSnapshotKey(ownerEmail: string, scope: WorkspaceScope): string {
  return workspaceSandboxId(ownerEmail, scope);
}

export type SnapshotPublishDecision =
  | { publish: true }
  | { publish: false; reason: "shrink_refused"; previousBytes: number; nextBytes: number };

export function decideSnapshotPublish(previousBytes: number | null, nextBytes: number): SnapshotPublishDecision {
  if (previousBytes === null || previousBytes < SHRINK_GUARD_MIN_PREVIOUS_BYTES) return { publish: true };
  if (nextBytes >= previousBytes * SHRINK_GUARD_RATIO) return { publish: true };
  return { publish: false, reason: "shrink_refused", previousBytes, nextBytes };
}

export function turnSnapshotDue(lastSnapshotAtMs: number | null, nowMs: number): boolean {
  return lastSnapshotAtMs === null || nowMs - lastSnapshotAtMs >= TURN_SNAPSHOT_COOLDOWN_MS;
}
