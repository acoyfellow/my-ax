import { Sandbox } from "@cloudflare/sandbox";
import { parseComputerSandboxName } from "./computer-id";
import { saveComputerSnapshot } from "./computer-records";
import { computerBackupOptions } from "./named-computer";

export type IdleSaveOutcome = "saved" | "not-running" | "unnamed" | "failed";

export class NamedComputer extends Sandbox {
  async saveHomeOnIdle(): Promise<IdleSaveOutcome> {
    if (!this.ctx.container?.running) return "not-running";
    const named = parseComputerSandboxName(await this.ctx.storage.get<string>("sandboxName"));
    if (!named) return "unnamed";
    try {
      const backup = await this.createBackup(computerBackupOptions(named.computerId, "idle"));
      await saveComputerSnapshot((this.env as { DB: unknown }).DB, named.ownerEmail, named.computerId, backup.id, backup.dir);
      console.info("named_computer.idle_saved", { computerId: named.computerId, backupId: backup.id });
      return "saved";
    } catch (error) {
      console.error("named_computer.idle_save_failed", { computerId: named.computerId, err: error instanceof Error ? error.message : String(error) });
      return "failed";
    }
  }

  override async onActivityExpired(): Promise<void> {
    await this.saveHomeOnIdle();
    await super.onActivityExpired();
  }
}
