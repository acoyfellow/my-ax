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

export const SANDBOX_ID_MAX_LENGTH = 63;

function fnv1a64Hex(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

export function workspaceSnapshotKey(ownerEmail: string, scope: WorkspaceScope): string {
  const owner = ownerEmail.toLowerCase();
  if (scope.kind === "owner") return owner;
  return `${owner}#chat:${scope.chatId.toLowerCase()}`;
}

export function workspaceSandboxId(ownerEmail: string, scope: WorkspaceScope): string {
  if (scope.kind === "owner") return ownerEmail.toLowerCase();
  const chatId = scope.chatId.toLowerCase();
  return `chat-${fnv1a64Hex(workspaceSnapshotKey(ownerEmail, scope))}-${chatId}`.slice(0, SANDBOX_ID_MAX_LENGTH).replace(/-+$/, "");
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
