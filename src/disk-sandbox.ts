import { Sandbox } from "@cloudflare/sandbox";

const BOOT_SNAPSHOT_KEY = "boot-snapshot";
const RESTORED_FROM_KEY = "restored-from";
const COMPUTER_IMAGE = "computer";

type ComputerSize = "lite" | "standard-1" | "standard-2" | "standard-3" | "standard-4";
const COMPUTER_SIZES: readonly ComputerSize[] = ["lite", "standard-1", "standard-2", "standard-3", "standard-4"];

function computerSize(env: unknown): ComputerSize {
  const requested = (env as { SANDBOX_INSTANCE?: string }).SANDBOX_INSTANCE;
  return COMPUTER_SIZES.find((size) => size === requested) ?? "standard-1";
}

function managedImage(container: Container): string | null {
  const images = (container as { images?: Record<string, string> }).images;
  return images?.[COMPUTER_IMAGE] ?? null;
}

type StartOptions = Parameters<Container["start"]>[0];

export type DiskSnapshot = { id: string; size: number };

export class DiskSandbox extends Sandbox {
  constructor(ctx: DurableObjectState<{}>, env: never) {
    super(ctx, env);
    const container = ctx.container;
    if (!container) return;
    const start = container.start.bind(container);
    container.start = (options?: StartOptions) => {
      const snapshotId = ctx.storage.kv.get<string>(BOOT_SNAPSHOT_KEY);
      const { image: _image, containerSnapshot: _snapshot, ...rest } = (options ?? { enableInternet: true }) as StartOptions & { image?: string; containerSnapshot?: unknown };
      const image = managedImage(container);
      if (snapshotId && image) {
        ctx.storage.kv.put(RESTORED_FROM_KEY, snapshotId);
        return start({ ...rest, instance: computerSize(env), containerSnapshot: { id: snapshotId } } as StartOptions);
      }
      ctx.storage.kv.delete(RESTORED_FROM_KEY);
      return start(image ? ({ ...rest, instance: computerSize(env), image } as StartOptions) : options);
    };
  }

  async saveDisk(name: string): Promise<DiskSnapshot | null> {
    const container = this.ctx.container;
    if (!container?.running) return null;
    const made = await container.snapshotContainer({ name });
    this.ctx.storage.kv.put(BOOT_SNAPSHOT_KEY, made.id);
    return { id: made.id, size: made.size };
  }

  async bootFrom(snapshotId: string): Promise<void> {
    this.ctx.storage.kv.put(BOOT_SNAPSHOT_KEY, snapshotId);
  }

  async diskState(): Promise<{ managed: boolean; bootSnapshot: string | null; restoredFrom: string | null }> {
    const container = this.ctx.container;
    return {
      managed: container ? managedImage(container) !== null : false,
      bootSnapshot: this.ctx.storage.kv.get<string>(BOOT_SNAPSHOT_KEY) ?? null,
      restoredFrom: this.ctx.storage.kv.get<string>(RESTORED_FROM_KEY) ?? null,
    };
  }

  async bootSnapshot(): Promise<string | null> {
    return this.ctx.storage.kv.get<string>(BOOT_SNAPSHOT_KEY) ?? null;
  }

  override async onActivityExpired(): Promise<void> {
    await this.saveDisk(`my-ax-idle-${Date.now()}`).catch((error: unknown) => console.error("disk_snapshot_on_idle_failed", { err: String(error) }));
    await super.onActivityExpired();
  }
}
