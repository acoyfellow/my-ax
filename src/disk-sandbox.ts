import { Sandbox } from "@cloudflare/sandbox";

const BOOT_SNAPSHOT_KEY = "boot-snapshot";

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
      if (!snapshotId || !options) return start(options);
      const { image: _image, ...rest } = options as StartOptions & { image?: string };
      return start({ ...rest, containerSnapshot: { id: snapshotId } } as StartOptions);
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

  async bootSnapshot(): Promise<string | null> {
    return this.ctx.storage.kv.get<string>(BOOT_SNAPSHOT_KEY) ?? null;
  }

  override async onActivityExpired(): Promise<void> {
    await this.saveDisk(`my-ax-idle-${Date.now()}`).catch((error: unknown) => console.error("disk_snapshot_on_idle_failed", { err: String(error) }));
    await super.onActivityExpired();
  }
}
