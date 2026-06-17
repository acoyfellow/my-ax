import type { WorkspaceLike } from "@cloudflare/think/tools/workspace";
import type { FileInfo } from "@cloudflare/shell";
import type { Env } from "./types";
import type { AccessIdentity } from "./auth";
import { USER_HOME } from "./sandbox";
import { getUserWorkspace } from "./workspace";

/**
 * Think workspace adapter for the my-ax cloud computer.
 *
 * Think's default Workspace stores files in the chat DO SQLite database. That
 * is intentionally not our product: my-ax files belong in the user's fast
 * Sandbox-local `/home/user`, restored/snapshotted by workspace.ts. This
 * adapter makes Think's native read/write/edit/list/find/grep/delete tools use
 * exactly that same workstation as shell_exec and the other workspace tools.
 */
export class SandboxThinkWorkspace implements WorkspaceLike {
  constructor(
    private readonly env: Env,
    private readonly identity: () => AccessIdentity | undefined,
  ) {}

  private requireIdentity(): AccessIdentity {
    const identity = this.identity();
    if (!identity) throw new Error("Workspace is unavailable until session identity is seeded.");
    return identity;
  }

  private path(path: string): string {
    if (!path || path === ".") return USER_HOME;
    return path.startsWith("/") ? path : `${USER_HOME}/${path.replace(/^\.\//, "")}`;
  }

  private async sandbox() {
    return (await getUserWorkspace(this.env, this.requireIdentity())).sandbox;
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
      const result = await (await this.sandbox()).readFile(this.path(path));
      const content = (result as { content?: string | Uint8Array }).content;
      if (typeof content === "string") return content;
      if (content instanceof Uint8Array) return new TextDecoder().decode(content);
      return null;
    } catch {
      return null;
    }
  }

  async readFileBytes(path: string): Promise<Uint8Array | null> {
    try {
      const stream = await (await this.sandbox()).readFileStream(this.path(path));
      const buffer = await new Response(stream).arrayBuffer();
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }

  async writeFile(path: string, content: string): Promise<void> {
    await (await this.sandbox()).writeFile(this.path(path), content);
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    await (await this.sandbox()).mkdir(this.path(path), { recursive: opts?.recursive ?? true });
  }

  async readDir(dir: string, opts?: { limit?: number; offset?: number }): Promise<FileInfo[]> {
    const result = await (await this.sandbox()).listFiles(this.path(dir), { recursive: false, includeHidden: true });
    const start = opts?.offset ?? 0;
    const end = opts?.limit === undefined ? undefined : start + opts.limit;
    return result.files.slice(start, end).map((file) => this.fileInfo(file));
  }

  async glob(pattern: string): Promise<FileInfo[]> {
    // The Sandbox SDK has no glob primitive; enumerate the workstation and
    // filter using shell's `find -path`, preserving normal filesystem glob
    // behavior without creating a second storage backend.
    const rootPattern = this.path(pattern);
    const { stdout } = await (await this.sandbox()).exec(
      `find ${JSON.stringify(USER_HOME)} -path ${JSON.stringify(rootPattern)} -print | head -500`,
      { cwd: USER_HOME, timeout: 30_000 },
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
      const result = await (await this.sandbox()).listFiles(parent, { recursive: false, includeHidden: true });
      const file = result.files.find((entry) => entry.absolutePath === absolute);
      return file ? this.fileInfo(file) : null;
    } catch {
      return null;
    }
  }

  async rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const absolute = this.path(path);
    if (absolute === USER_HOME) throw new Error("Refusing to delete the workspace root.");
    if (opts?.recursive) {
      const flags = opts.force ? "-rf" : "-r";
      const result = await (await this.sandbox()).exec(`rm ${flags} -- ${JSON.stringify(absolute)}`, { cwd: USER_HOME, timeout: 30_000 });
      if (!result.success && !opts.force) throw new Error(result.stderr || `Failed to delete ${absolute}`);
      return;
    }
    try {
      await (await this.sandbox()).deleteFile(absolute);
    } catch (error) {
      if (!opts?.force) throw error;
    }
  }
}
