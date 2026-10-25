import type { WorkspaceLike } from "./think-workspace-fs";
import type { FileInfo } from "@cloudflare/shell";
import { collectFile } from "@cloudflare/sandbox";
import type { Env } from "./types";
import type { AccessIdentity } from "./auth";
import { workspaceFor, type WorkspaceStub } from "./workspace";
import type { WorkspaceScope } from "./workspace-policy";
import { globSearchRoot } from "./workspace-exec";
import { WORKSPACE_HOME, assertSeedablePath } from "./workspace-path";

/**
 * Think workspace adapter for the my-ax cloud computer.
 *
 * Think's default Workspace stores files in the chat DO SQLite database. That
 * is intentionally not our product: my-ax files belong in the user's fast
 * Sandbox-local `/home/user`, restored/snapshotted by workspace.ts. This
 * adapter makes Think's native read/write/edit/list/find/grep/delete tools use
 * exactly that same workstation as shell_exec and the other workspace tools.
 */
export async function fileStreamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const { content } = await collectFile(stream);
  return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

export class SandboxThinkWorkspace implements WorkspaceLike {
  constructor(
    private readonly env: Env,
    private readonly identity: () => AccessIdentity | undefined,
    private readonly scope: WorkspaceScope = { kind: "owner" },
  ) {}

  private requireIdentity(): AccessIdentity {
    const identity = this.identity();
    if (!identity) throw new Error("Workspace is unavailable until session identity is seeded.");
    return identity;
  }

  private path(path: string): string {
    if (!path || path === ".") return WORKSPACE_HOME;
    const absolute = path.startsWith("/") ? path : `${WORKSPACE_HOME}/${path.replace(/^\.\//, "")}`;
    assertSeedablePath(absolute);
    return absolute;
  }

  private workspace(): Promise<WorkspaceStub> {
    return workspaceFor(this.env, this.requireIdentity(), this.scope);
  }

  private fileInfo(file: { name: string; absolutePath: string; type: "file" | "directory" | "symlink" | "other"; size: number; modifiedAt: string }): FileInfo {
    const type = file.type === "other" ? "file" : file.type;
    const updatedAt = Date.parse(file.modifiedAt) || Date.now();
    return {
      path: file.absolutePath,
      name: file.name,
      type,
      mimeType: "application/octet-stream",
      size: file.size,
      createdAt: updatedAt,
      updatedAt,
    };
  }

  async readFile(path: string): Promise<string | null> {
    try {
      return await (await this.workspace()).read(this.path(path));
    } catch {
      return null;
    }
  }

  async readFileBytes(path: string): Promise<Uint8Array | null> {
    try {
      return await (await this.workspace()).readBytes(this.path(path));
    } catch {
      return null;
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    await (await this.workspace()).write(this.path(path), content);
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    await (await this.workspace()).makeDirectory(this.path(path));
  }

  async readDir(dir: string, opts?: { limit?: number; offset?: number }): Promise<FileInfo[]> {
    const files = await (await this.workspace()).list(this.path(dir), { recursive: false, includeHidden: true });
    const start = opts?.offset ?? 0;
    const end = opts?.limit === undefined ? undefined : start + opts.limit;
    return files.slice(start, end).map((file) => this.fileInfo(file));
  }

  async glob(pattern: string): Promise<FileInfo[]> {
    const rootPattern = this.path(pattern);
    const { stdout } = await (await this.workspace()).shell(
      `find ${JSON.stringify(globSearchRoot(rootPattern, WORKSPACE_HOME))} -path ${JSON.stringify(rootPattern)} -print | head -500`,
      { cwd: WORKSPACE_HOME, timeout: 30_000 },
    );
    const matches = stdout.split("\n").map((value) => value.trim()).filter(Boolean);
    const infos: FileInfo[] = [];
    for (const matched of matches) {
      const stat = await this.stat(matched);
      if (stat) infos.push(stat);
    }
    return infos;
  }

  async stat(path: string): Promise<FileInfo | null> {
    const absolute = this.path(path);
    const parent = absolute.slice(0, absolute.lastIndexOf("/")) || "/";
    try {
      const files = await (await this.workspace()).list(parent, { recursive: false, includeHidden: true });
      const file = files.find((entry) => entry.absolutePath === absolute);
      return file ? this.fileInfo(file) : null;
    } catch {
      return null;
    }
  }

  async rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const absolute = this.path(path);
    if (absolute === WORKSPACE_HOME) throw new Error("Refusing to delete the workspace root.");
    if (opts?.recursive) {
      const flags = opts.force ? "-rf" : "-r";
      const result = await (await this.workspace()).shell(`rm ${flags} -- ${JSON.stringify(absolute)}`, { cwd: WORKSPACE_HOME, timeout: 30_000 });
      if (result.exitCode !== 0 && !opts.force) throw new Error(result.stderr || `Failed to delete ${absolute}`);
      return;
    }
    try {
      await (await this.workspace()).remove(absolute);
    } catch (error) {
      if (!opts?.force) throw error;
    }
  }
}
