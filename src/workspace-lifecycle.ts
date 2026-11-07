import { bootIsCurrent, initialVerification, nextVerification, type WorkspaceVerification } from "./fsm/workspace-verification";

export type OperationKind = "idempotent" | "side-effecting";

export class WorkspaceLost extends Error {
  override readonly name = "WorkspaceLost";
}

export type LifecycleDeps = {
  running: () => boolean;
  healthy: () => Promise<boolean>;
  boot: () => Promise<void>;
  destroy: () => Promise<void>;
  expectedRunning: () => boolean;
  setExpectedRunning: (expected: boolean) => void;
  announceLoss: (reason: string) => Promise<void>;
};

export type WorkspaceLifecycle = {
  awake: () => Promise<void>;
  use: <T>(kind: OperationKind, operation: () => Promise<T>) => Promise<T>;
  stopped: () => void;
  verification: () => WorkspaceVerification;
};

export const LOST_MID_COMMAND_NOTE = "the workspace container stopped while this command was running; it was restarted, and the command was not re-run because it may have partially completed";
export const STOPPED_UNEXPECTEDLY = "the container stopped without being paused";
export const UNRESPONSIVE = "the container stopped responding and was replaced";

export function createWorkspaceLifecycle(deps: LifecycleDeps): WorkspaceLifecycle {
  let booting: Promise<void> | undefined;
  let state = initialVerification();

  const bootOnce = (): Promise<void> => {
    booting ??= (async () => {
      state = nextVerification(state, "boot_started");
      const epoch = state.epoch;
      try {
        if (deps.expectedRunning() && !deps.running()) await deps.announceLoss(STOPPED_UNEXPECTEDLY);
        await deps.boot();
        if (!bootIsCurrent(state, epoch)) return;
        deps.setExpectedRunning(true);
        state = nextVerification(state, "boot_succeeded", epoch);
      } catch (error) {
        state = nextVerification(state, "boot_failed", epoch);
        throw error;
      }
    })().finally(() => {
      booting = undefined;
    });
    return booting;
  };

  const awake = async (): Promise<void> => {
    if (booting) return booting;
    if (state.kind === "verified" && deps.running()) return;
    state = nextVerification(state, "found_not_running");
    await bootOnce();
  };

  const stillAlive = async (): Promise<boolean> => deps.running() && await deps.healthy().catch(() => false);

  const replace = async (): Promise<void> => {
    await deps.announceLoss(UNRESPONSIVE);
    deps.setExpectedRunning(false);
    state = nextVerification(state, "replaced");
    await deps.destroy().catch(() => undefined);
    await bootOnce();
  };

  const use = async <T>(kind: OperationKind, operation: () => Promise<T>): Promise<T> => {
    try {
      await awake();
    } catch (error) {
      if (await stillAlive()) throw error;
      await replace();
    }
    try {
      return await operation();
    } catch (error) {
      if (await stillAlive()) throw error;
      await replace();
      if (kind === "side-effecting") throw new WorkspaceLost(LOST_MID_COMMAND_NOTE);
      return operation();
    }
  };

  const stopped = (): void => {
    state = nextVerification(state, "stopped");
    deps.setExpectedRunning(false);
  };

  return { awake, use, stopped, verification: () => state };
}
