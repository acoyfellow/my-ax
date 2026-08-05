import { COMPUTER_OWNER_MAX_RETAINED_WRITE_BYTES } from "./computer-retained-write-budget";

export { COMPUTER_OWNER_MAX_RETAINED_WRITE_BYTES } from "./computer-retained-write-budget";

export const COMPUTER_HOME = "/home/user";
export const COMPUTER_READ_MAX_BYTES = 32 * 1024;
export const COMPUTER_WRITE_MAX_BYTES = 32 * 1024;
export const COMPUTER_LIST_MAX_ENTRIES = 100;
export const COMPUTER_GREP_MAX_MATCHES = 100;
export const COMPUTER_GREP_MAX_PATTERN_LENGTH = 256;
export const COMPUTER_GREP_MAX_FILES = 128;
export const COMPUTER_GREP_MAX_DIRECTORIES = 64;
export const COMPUTER_GREP_MAX_TOTAL_BYTES = 256 * 1024;
export const COMPUTER_GREP_DEADLINE_MS = 2_000;
export const COMPUTER_OUTPUT_MAX_BYTES = 32 * 1024;
export const COMPUTER_OWNER_MAX_FILES = 512;
export const COMPUTER_OWNER_MAX_STORAGE_BYTES = 4 * 1024 * 1024;
export const COMPUTER_OWNER_MAX_DIRECTORIES = 256;

export const COMPUTER_WORK_METHODS = [
  { name: "read", description: "Read one bounded UTF-8 file from the isolated Computer workspace." },
  { name: "write", description: "Write one bounded UTF-8 file in the isolated Computer workspace." },
  { name: "list", description: "List one bounded directory in the isolated Computer workspace." },
  { name: "grep", description: "Search bounded text matches in the isolated Computer workspace." },
] as const;

type ComputerStat = {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
};

type ComputerDirectoryEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
};

export type ComputerFilesystem = {
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  lstat: (path: string) => Promise<ComputerStat>;
  readdir: (path: string, options?: { limit?: number }) => Promise<ComputerDirectoryEntry[]>;
  writeFile: (path: string, content: string) => Promise<void>;
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  rm: (path: string, options?: { recursive?: boolean; force?: boolean }) => Promise<void>;
};

export type ComputerWorkspaceClient = {
  fs: ComputerFilesystem;
  [Symbol.dispose](): void;
};

const encoder = new TextEncoder();

export function resolveComputerPath(value: unknown): string {
  if (typeof value !== "string" || !value || encoder.encode(value).byteLength > 1024 || value.includes("\0")) {
    throw new Error("Computer path must be a non-empty string of at most 1024 bytes without NUL.");
  }
  if (value.includes("//")) throw new Error("Computer paths must not contain empty segments.");
  if (value !== COMPUTER_HOME && !value.startsWith(`${COMPUTER_HOME}/`)) {
    throw new Error(`Computer paths must stay under ${COMPUTER_HOME}.`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Computer paths must not contain traversal segments.");
  }
  return value.endsWith("/") && value !== COMPUTER_HOME ? value.slice(0, -1) : value;
}

export async function withComputerWorkspace<T>(
  openWorkspace: () => Promise<ComputerWorkspaceClient>,
  operation: (workspace: ComputerWorkspaceClient) => Promise<T>,
): Promise<T> {
  const workspace = await openWorkspace();
  try {
    return await operation(workspace);
  } finally {
    workspace[Symbol.dispose]();
  }
}

async function lstatOrNull(fs: ComputerFilesystem, path: string): Promise<ComputerStat | null> {
  try {
    return await fs.lstat(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function childPath(parent: string, name: string): string | null {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) return null;
  return resolveComputerPath(`${parent}/${name}`);
}

function assertFileSize(stat: ComputerStat, maximum: number, message: string): void {
  if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > maximum) throw new Error(message);
}

async function assertExistingPathIsSafe(fs: ComputerFilesystem, path: string, allowMissingLeaf = false): Promise<ComputerStat | null> {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  let leaf: ComputerStat | null = null;
  for (let index = 0; index < parts.length; index++) {
    current += `/${parts[index]}`;
    const stat = await lstatOrNull(fs, current);
    if (!stat) {
      if (allowMissingLeaf && index === parts.length - 1) return null;
      throw new Error(`Computer path does not exist: ${current}`);
    }
    if (stat.isSymbolicLink) throw new Error(`Computer paths cannot traverse symbolic links: ${current}`);
    if (index < parts.length - 1 && !stat.isDirectory) throw new Error(`Computer path component is not a directory: ${current}`);
    leaf = stat;
  }
  return leaf;
}

async function ensureComputerHome(fs: ComputerFilesystem): Promise<void> {
  const homeParent = await lstatOrNull(fs, "/home");
  if (homeParent?.isSymbolicLink) throw new Error("Computer paths cannot traverse symbolic links: /home");
  if (homeParent && !homeParent.isDirectory) throw new Error("Computer path component is not a directory: /home");
  const existingHome = await lstatOrNull(fs, COMPUTER_HOME);
  if (!existingHome) await fs.mkdir(COMPUTER_HOME, { recursive: true });
  const home = await assertExistingPathIsSafe(fs, COMPUTER_HOME);
  if (!home?.isDirectory) throw new Error("Computer home is not a directory.");
}

type ComputerWritePreparation = {
  missingDirectories: string[];
};

async function prepareComputerWrite(fs: ComputerFilesystem, path: string, contentBytes: number): Promise<ComputerWritePreparation> {
  await ensureComputerHome(fs);
  const relative = parentPath(path).slice(COMPUTER_HOME.length).split("/").filter(Boolean);
  const missingDirectories: string[] = [];
  let current = COMPUTER_HOME;
  for (const segment of relative) {
    current += `/${segment}`;
    const stat = await lstatOrNull(fs, current);
    if (!stat) {
      missingDirectories.push(current);
      continue;
    }
    if (stat.isSymbolicLink) throw new Error(`Computer paths cannot traverse symbolic links: ${current}`);
    if (!stat.isDirectory) throw new Error(`Computer path component is not a directory: ${current}`);
  }
  const existing = missingDirectories.length ? null : await assertExistingPathIsSafe(fs, path, true);
  if (existing?.isDirectory || (existing && !existing.isFile)) throw new Error("Computer write requires a regular file path.");
  if (existing?.isFile) assertFileSize(existing, COMPUTER_OWNER_MAX_STORAGE_BYTES, "Computer file has an invalid size.");
  const usage = await computerUsage(fs);
  if (usage.directories + missingDirectories.length > COMPUTER_OWNER_MAX_DIRECTORIES) {
    throw new Error(`Computer owner directory quota exceeded (${COMPUTER_OWNER_MAX_DIRECTORIES}).`);
  }
  assertOwnerWriteQuota(usage, existing, contentBytes);
  return { missingDirectories };
}

function requireBoundedString(value: unknown, field: string, maxBytes: number, allowEmpty = true): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) throw new Error(`Computer ${field} must be ${allowEmpty ? "a string" : "a non-empty string"}.`);
  if (encoder.encode(value).byteLength > maxBytes) throw new Error(`Computer ${field} must be at most ${maxBytes} bytes.`);
  return value;
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (encoder.encode(value).byteLength <= maxBytes) return value;
  const suffix = "…";
  const available = maxBytes - encoder.encode(suffix).byteLength;
  let result = "";
  for (const character of value) {
    if (encoder.encode(result + character).byteLength > available) break;
    result += character;
  }
  return `${result}${suffix}`;
}

function boundedItems<T>(items: T[], toSafeValue: (item: T) => unknown): { items: unknown[]; truncated: boolean } {
  const result: unknown[] = [];
  let bytes = 0;
  for (const item of items) {
    const value = toSafeValue(item);
    const valueBytes = encoder.encode(JSON.stringify(value)).byteLength;
    if (result.length >= COMPUTER_LIST_MAX_ENTRIES || bytes + valueBytes > COMPUTER_OUTPUT_MAX_BYTES) break;
    result.push(value);
    bytes += valueBytes;
  }
  return { items: result, truncated: result.length < items.length };
}

type ComputerUsage = {
  directories: number;
  files: number;
  bytes: number;
};

async function computerUsage(fs: ComputerFilesystem): Promise<ComputerUsage> {
  const directories = [COMPUTER_HOME];
  let directoryCount = 0;
  let files = 0;
  let bytes = 0;
  while (directories.length) {
    const directory = directories.shift()!;
    directoryCount += 1;
    if (directoryCount > COMPUTER_OWNER_MAX_DIRECTORIES) throw new Error(`Computer owner directory quota exceeded (${COMPUTER_OWNER_MAX_DIRECTORIES}).`);
    const remainingEntries = COMPUTER_OWNER_MAX_FILES + COMPUTER_OWNER_MAX_DIRECTORIES + 1 - files - directoryCount;
    if (remainingEntries <= 0) throw new Error(`Computer owner file quota exceeded (${COMPUTER_OWNER_MAX_FILES}).`);
    const entries = (await fs.readdir(directory, { limit: remainingEntries + 1 })).slice(0, remainingEntries + 1);
    if (entries.length > remainingEntries) throw new Error(`Computer owner file quota exceeded (${COMPUTER_OWNER_MAX_FILES}).`);
    for (const entry of entries) {
      const path = childPath(directory, entry.name);
      if (!path) continue;
      const stat = await lstatOrNull(fs, path);
      if (!stat || stat.isSymbolicLink) continue;
      if (stat.isDirectory) {
        directories.push(path);
        continue;
      }
      if (!stat.isFile) continue;
      assertFileSize(stat, COMPUTER_OWNER_MAX_STORAGE_BYTES, "Computer file has an invalid size.");
      files += 1;
      bytes += stat.size;
      if (files > COMPUTER_OWNER_MAX_FILES) throw new Error(`Computer owner file quota exceeded (${COMPUTER_OWNER_MAX_FILES}).`);
      if (bytes > COMPUTER_OWNER_MAX_STORAGE_BYTES) throw new Error(`Computer owner storage quota exceeded (${COMPUTER_OWNER_MAX_STORAGE_BYTES} bytes).`);
    }
  }
  return { directories: directoryCount, files, bytes };
}

function assertOwnerWriteQuota(usage: ComputerUsage, existing: ComputerStat | null, contentBytes: number): void {
  const existingBytes = existing?.isFile ? existing.size : 0;
  if (usage.files + (existing?.isFile ? 0 : 1) > COMPUTER_OWNER_MAX_FILES) {
    throw new Error(`Computer owner file quota exceeded (${COMPUTER_OWNER_MAX_FILES}).`);
  }
  if (usage.bytes - existingBytes + contentBytes > COMPUTER_OWNER_MAX_STORAGE_BYTES) {
    throw new Error(`Computer owner storage quota exceeded (${COMPUTER_OWNER_MAX_STORAGE_BYTES} bytes).`);
  }
}

export async function readComputerFileFromWorkspace(workspace: Pick<ComputerWorkspaceClient, "fs">, input: unknown) {
  const path = resolveComputerPath((input as { path?: unknown } | null)?.path);
  await ensureComputerHome(workspace.fs);
  const stat = await assertExistingPathIsSafe(workspace.fs, path);
  if (!stat?.isFile) throw new Error("Computer read requires a regular file.");
  assertFileSize(stat, COMPUTER_READ_MAX_BYTES, `Computer file exceeds the ${COMPUTER_READ_MAX_BYTES}-byte read limit.`);
  const content = await workspace.fs.readFile(path, "utf8");
  const bytes = encoder.encode(content).byteLength;
  if (bytes > COMPUTER_READ_MAX_BYTES) throw new Error(`Computer file exceeds the ${COMPUTER_READ_MAX_BYTES}-byte read limit.`);
  return { path, content, bytes };
}

export type ComputerWriteInput = {
  path: string;
  content: string;
  contentBytes: number;
};

export function parseComputerWriteInput(input: unknown): ComputerWriteInput {
  const path = resolveComputerPath((input as { path?: unknown } | null)?.path);
  const content = requireBoundedString((input as { content?: unknown } | null)?.content, "content", COMPUTER_WRITE_MAX_BYTES);
  return { path, content, contentBytes: encoder.encode(content).byteLength };
}

export async function writeComputerFileFromWorkspace(workspace: Pick<ComputerWorkspaceClient, "fs">, input: unknown) {
  const { path, content, contentBytes } = parseComputerWriteInput(input);
  const { missingDirectories } = await prepareComputerWrite(workspace.fs, path, contentBytes);
  let createdParentRoot: string | null = null;
  try {
    for (const directory of missingDirectories) {
      await workspace.fs.mkdir(directory);
      createdParentRoot ??= directory;
    }
    await workspace.fs.writeFile(path, content);
  } catch (error) {
    if (createdParentRoot) await workspace.fs.rm(createdParentRoot, { recursive: true, force: true });
    throw error;
  }
  return { path, bytesWritten: contentBytes };
}

export async function listComputerFilesFromWorkspace(workspace: Pick<ComputerWorkspaceClient, "fs">, input: unknown) {
  const path = resolveComputerPath((input as { path?: unknown } | null)?.path ?? COMPUTER_HOME);
  await ensureComputerHome(workspace.fs);
  const stat = await assertExistingPathIsSafe(workspace.fs, path);
  if (!stat?.isDirectory) throw new Error("Computer list requires a directory.");
  const entries = await workspace.fs.readdir(path, { limit: COMPUTER_LIST_MAX_ENTRIES + 1 });
  const bounded = boundedItems(entries, (entry) => ({
    name: truncateUtf8(entry.name, 512),
    type: entry.isDirectory ? "directory" : entry.isSymbolicLink ? "symlink" : entry.isFile ? "file" : "other",
  }));
  return { path, entries: bounded.items, truncated: bounded.truncated };
}

function matchingLines(content: string, query: string, ignoreCase: boolean, path: string, matches: Array<{ path: string; line: number; text: string }>): void {
  const needle = ignoreCase ? query.toUpperCase() : query;
  for (const [index, line] of content.split("\n").entries()) {
    if ((ignoreCase ? line.toUpperCase() : line).includes(needle)) {
      matches.push({ path, line: index + 1, text: truncateUtf8(line, 512) });
      if (matches.length >= COMPUTER_GREP_MAX_MATCHES) return;
    }
  }
}

export async function grepComputerFilesFromWorkspace(workspace: Pick<ComputerWorkspaceClient, "fs">, input: unknown) {
  const values = input as { path?: unknown; query?: unknown; ignoreCase?: unknown } | null;
  const path = resolveComputerPath(values?.path ?? COMPUTER_HOME);
  const query = requireBoundedString(values?.query, "grep query", COMPUTER_GREP_MAX_PATTERN_LENGTH, false);
  await ensureComputerHome(workspace.fs);
  const root = await assertExistingPathIsSafe(workspace.fs, path);
  if (!root?.isDirectory && !root?.isFile) throw new Error("Computer grep requires a file or directory.");

  const deadline = Date.now() + COMPUTER_GREP_DEADLINE_MS;
  const directories = root.isDirectory ? [path] : [];
  const files = root.isFile ? [path] : [];
  const matches: Array<{ path: string; line: number; text: string }> = [];
  let directoryCount = 0;
  let fileCount = 0;
  let scannedBytes = 0;
  let truncated = false;

  while (directories.length || files.length) {
    if (Date.now() > deadline) {
      truncated = true;
      break;
    }
    if (files.length) {
      const file = files.shift()!;
      fileCount += 1;
      if (fileCount > COMPUTER_GREP_MAX_FILES) {
        truncated = true;
        break;
      }
      const stat = await assertExistingPathIsSafe(workspace.fs, file);
      if (!stat?.isFile) continue;
      if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > COMPUTER_READ_MAX_BYTES) {
        truncated = true;
        continue;
      }
      if (scannedBytes + stat.size > COMPUTER_GREP_MAX_TOTAL_BYTES) {
        truncated = true;
        break;
      }
      const content = await workspace.fs.readFile(file, "utf8");
      const bytes = encoder.encode(content).byteLength;
      if (bytes > COMPUTER_READ_MAX_BYTES || scannedBytes + bytes > COMPUTER_GREP_MAX_TOTAL_BYTES) {
        truncated = true;
        break;
      }
      scannedBytes += bytes;
      matchingLines(content, query, values?.ignoreCase === true, file, matches);
      if (matches.length >= COMPUTER_GREP_MAX_MATCHES) {
        truncated = true;
        break;
      }
      continue;
    }

    const directory = directories.shift()!;
    directoryCount += 1;
    if (directoryCount > COMPUTER_GREP_MAX_DIRECTORIES) {
      truncated = true;
      break;
    }
    const remainingEntries = COMPUTER_GREP_MAX_FILES + COMPUTER_GREP_MAX_DIRECTORIES + 1 - fileCount - directoryCount - directories.length - files.length;
    if (remainingEntries <= 0) {
      truncated = true;
      break;
    }
    const entries = (await workspace.fs.readdir(directory, { limit: remainingEntries + 1 })).slice(0, remainingEntries + 1);
    if (entries.length > remainingEntries) truncated = true;
    for (const entry of entries.slice(0, remainingEntries)) {
      const child = childPath(directory, entry.name);
      if (!child || entry.isSymbolicLink) continue;
      const stat = await lstatOrNull(workspace.fs, child);
      if (!stat || stat.isSymbolicLink) continue;
      if (stat.isDirectory) directories.push(child);
      else if (stat.isFile) files.push(child);
    }
  }

  const bounded = boundedItems(matches, (match) => match);
  return { path, matches: bounded.items, truncated: truncated || bounded.truncated };
}

export async function computerHealthFromWorkspace(workspace: Pick<ComputerWorkspaceClient, "fs">, retainedWriteReservedBytes: number) {
  const home = await lstatOrNull(workspace.fs, COMPUTER_HOME);
  return {
    ownerScoped: true,
    home: COMPUTER_HOME,
    storage: "durable-object-sqlite",
    executionBackends: [] as string[],
    homeReady: Boolean(home?.isDirectory && !home.isSymbolicLink),
    quotas: {
      files: COMPUTER_OWNER_MAX_FILES,
      liveLogicalStorageBytes: COMPUTER_OWNER_MAX_STORAGE_BYTES,
      retainedWriteReservedBytes,
      retainedWriteBudgetBytes: COMPUTER_OWNER_MAX_RETAINED_WRITE_BYTES,
    },
  };
}
