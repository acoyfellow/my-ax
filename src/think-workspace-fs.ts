import type { ThinkWorkspace, ThinkWorkspaceFilesystem } from "@cloudflare/think";
import type { FileInfo } from "@cloudflare/shell";

export interface WorkspaceLike {
  readFile(path: string): Promise<string | null>;
  readFileBytes(path: string): Promise<Uint8Array | null>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  readDir(dir: string, opts?: { limit?: number; offset?: number }): Promise<FileInfo[]>;
  glob(pattern: string): Promise<FileInfo[]>;
  stat(path: string): Promise<FileInfo | null>;
  rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

type WorkspaceFs = ThinkWorkspaceFilesystem;
type ReadFileOptions = { encoding?: "utf8"; byteOffset?: number; byteLength?: number };
type WriteFileContent = string | Uint8Array | ReadableStream<Uint8Array>;
type StatResult = Awaited<ReturnType<WorkspaceFs["stat"]>>;
type DirentResult = Awaited<ReturnType<WorkspaceFs["readdir"]>>[number];
type FoundEntry = Awaited<ReturnType<WorkspaceFs["find"]>>[number];
type GrepMatch = Awaited<ReturnType<WorkspaceFs["grep"]>>[number];
type GrepOptions = { ignoreCase?: boolean; regex?: boolean; context?: number; limit?: number; offset?: number; include?: string; exclude?: string[] };

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const GREP_MAX_FILES = 200;
const GREP_MAX_FILE_BYTES = 1_000_000;

export class WorkspaceNotFoundError extends Error {
  readonly code = "ENOENT";
  constructor(path: string) {
    super(`ENOENT: no such file or directory, ${path}`);
    this.name = "WorkspaceNotFoundError";
  }
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function bytesOf(content: WriteFileContent): Promise<Uint8Array> {
  if (typeof content === "string") return TEXT_ENCODER.encode(content);
  if (content instanceof Uint8Array) return content;
  return new Uint8Array(await new Response(content).arrayBuffer());
}

function sliceBytes(bytes: Uint8Array, options?: ReadFileOptions): Uint8Array {
  const start = options?.byteOffset ?? 0;
  const end = options?.byteLength === undefined ? undefined : start + options.byteLength;
  return start === 0 && end === undefined ? bytes : bytes.slice(start, end);
}

function joinPath(directory: string, name: string): string {
  return directory.endsWith("/") ? `${directory}${name}` : `${directory}/${name}`;
}

export function statFromFileInfo(info: FileInfo): StatResult {
  return {
    name: info.name,
    inode: 0,
    mode: info.type === "directory" ? 0o40755 : 0o100644,
    mtime: info.updatedAt,
    size: info.size,
    isFile: info.type === "file",
    isDirectory: info.type === "directory",
    isSymbolicLink: info.type === "symlink",
  } as StatResult;
}

export function direntFromFileInfo(info: FileInfo, directory: string): DirentResult {
  return {
    name: info.name,
    parentPath: directory,
    size: info.size,
    mtime: info.updatedAt,
    isFile: info.type === "file",
    isDirectory: info.type === "directory",
    isSymbolicLink: info.type === "symlink",
  } as DirentResult;
}

function lineMatcher(pattern: string, options?: GrepOptions): (line: string) => boolean {
  if (options?.regex) {
    const expression = new RegExp(pattern, options.ignoreCase ? "i" : "");
    return (line) => expression.test(line);
  }
  const needle = options?.ignoreCase ? pattern.toLowerCase() : pattern;
  return (line) => (options?.ignoreCase ? line.toLowerCase() : line).includes(needle);
}

export function grepText(path: string, text: string, pattern: string, options?: GrepOptions): GrepMatch[] {
  const matches = lineMatcher(pattern, options);
  const lines = text.split("\n");
  const context = Math.max(0, options?.context ?? 0);
  const found: GrepMatch[] = [];
  lines.forEach((line, index) => {
    if (!matches(line)) return;
    const match = { path, line: index + 1, text: line } as GrepMatch & { context?: Array<{ line: number; text: string; isMatch: boolean }> };
    if (context > 0) {
      const from = Math.max(0, index - context);
      const to = Math.min(lines.length - 1, index + context);
      match.context = lines.slice(from, to + 1).map((text, offset) => ({ line: from + offset + 1, text, isMatch: from + offset === index }));
    }
    found.push(match);
  });
  return found;
}

function page<T>(items: T[], options?: { limit?: number; offset?: number }): T[] {
  const start = options?.offset ?? 0;
  return items.slice(start, options?.limit === undefined ? undefined : start + options.limit);
}

export function workspaceFilesystem(workspace: WorkspaceLike): WorkspaceFs {
  async function readBytes(path: string): Promise<Uint8Array> {
    const bytes = await workspace.readFileBytes(path);
    if (bytes === null) throw new WorkspaceNotFoundError(path);
    return bytes;
  }

  async function statOrThrow(path: string): Promise<StatResult> {
    const info = await workspace.stat(path);
    if (!info) throw new WorkspaceNotFoundError(path);
    return statFromFileInfo(info);
  }

  async function filesUnder(path: string): Promise<string[]> {
    const info = await workspace.stat(path);
    if (!info) throw new WorkspaceNotFoundError(path);
    if (info.type !== "directory") return [path];
    const matches = await workspace.glob(`${path.replace(/\/+$/, "")}/**`);
    return matches.filter((entry) => entry.type === "file").map((entry) => entry.path).slice(0, GREP_MAX_FILES);
  }

  const fs = {
    async readFile(path: string, options?: "utf8" | ReadFileOptions) {
      const resolved = typeof options === "string" ? { encoding: options } : options;
      const bytes = sliceBytes(await readBytes(path), resolved);
      return resolved?.encoding === "utf8" ? TEXT_DECODER.decode(bytes) : streamOf(bytes);
    },
    async writeFile(path: string, content: WriteFileContent) {
      const bytes = await bytesOf(content);
      await workspace.writeFile(path, TEXT_DECODER.decode(bytes));
    },
    async mkdir(path: string, options?: { recursive?: boolean }) {
      await workspace.mkdir(path, { recursive: options?.recursive ?? false });
    },
    async rm(path: string, options?: { recursive?: boolean; force?: boolean }) {
      if (!options?.force && !(await workspace.stat(path))) throw new WorkspaceNotFoundError(path);
      await workspace.rm(path, options);
    },
    async stat(path: string) {
      return await statOrThrow(path);
    },
    async readdir(path: string, options?: { limit?: number; offset?: number }) {
      const info = await workspace.stat(path);
      if (!info) throw new WorkspaceNotFoundError(path);
      const entries = await workspace.readDir(path, options);
      return entries.map((entry) => direntFromFileInfo(entry, path));
    },
    async find(directory: string, pattern = "**", options?: { limit?: number; offset?: number; exclude?: string[] }) {
      const root = directory.replace(/\/+$/, "") || "/";
      const matches = await workspace.glob(joinPath(root, pattern));
      const found: FoundEntry[] = matches.map((entry) => ({ path: entry.path, type: entry.type === "directory" ? "dir" : "file" }) as FoundEntry);
      return page(found, options);
    },
    async grep(pattern: string, path: string, options?: GrepOptions) {
      const found: GrepMatch[] = [];
      for (const file of await filesUnder(path)) {
        const bytes = await workspace.readFileBytes(file);
        if (!bytes || bytes.byteLength > GREP_MAX_FILE_BYTES) continue;
        found.push(...grepText(file, TEXT_DECODER.decode(bytes), pattern, options));
      }
      return page(found, options);
    },
  };
  return fs as unknown as WorkspaceFs;
}

export function thinkWorkspaceFor(workspace: WorkspaceLike): ThinkWorkspace & WorkspaceLike {
  const fs = workspaceFilesystem(workspace);
  return Object.assign(workspace, { fs }) as ThinkWorkspace & WorkspaceLike;
}
