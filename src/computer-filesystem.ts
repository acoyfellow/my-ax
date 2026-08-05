export const COMPUTER_HOME = "/home/user";
export const COMPUTER_READ_MAX_BYTES = 32 * 1024;
export const COMPUTER_WRITE_MAX_BYTES = 32 * 1024;
export const COMPUTER_LIST_MAX_ENTRIES = 100;
export const COMPUTER_GREP_MAX_MATCHES = 100;
export const COMPUTER_GREP_MAX_PATTERN_LENGTH = 256;
export const COMPUTER_OUTPUT_MAX_BYTES = 32 * 1024;

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

type ComputerGrepMatch = {
  path: string;
  line: number;
  text: string;
};

export type ComputerFilesystem = {
  readFile: (path: string, encoding: "utf8") => Promise<string>;
  lstat: (path: string) => Promise<ComputerStat>;
  readdir: (path: string, options?: { limit?: number }) => Promise<ComputerDirectoryEntry[]>;
  grep: (pattern: string, path: string, options?: { ignoreCase?: boolean }) => Promise<ComputerGrepMatch[]>;
  writeFile: (path: string, content: string) => Promise<void>;
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
};

export type ComputerWorkspaceClient = {
  fs: ComputerFilesystem;
  [Symbol.dispose](): void;
};

export function resolveComputerPath(value: unknown): string {
  if (typeof value !== "string" || !value || new TextEncoder().encode(value).byteLength > 1024 || value.includes("\0")) {
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
  await fs.mkdir(COMPUTER_HOME, { recursive: true });
  const home = await assertExistingPathIsSafe(fs, COMPUTER_HOME);
  if (!home?.isDirectory) throw new Error("Computer home is not a directory.");
}

async function prepareComputerParent(fs: ComputerFilesystem, path: string): Promise<void> {
  await ensureComputerHome(fs);
  const relative = parentPath(path).slice(COMPUTER_HOME.length).split("/").filter(Boolean);
  let current = COMPUTER_HOME;
  for (const segment of relative) {
    current += `/${segment}`;
    const stat = await lstatOrNull(fs, current);
    if (!stat) {
      await fs.mkdir(current);
      continue;
    }
    if (stat.isSymbolicLink) throw new Error(`Computer paths cannot traverse symbolic links: ${current}`);
    if (!stat.isDirectory) throw new Error(`Computer path component is not a directory: ${current}`);
  }
  await assertExistingPathIsSafe(fs, parentPath(path));
}

function requireBoundedString(value: unknown, field: string, maxBytes: number, allowEmpty = true): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) throw new Error(`Computer ${field} must be ${allowEmpty ? "a string" : "a non-empty string"}.`);
  if (new TextEncoder().encode(value).byteLength > maxBytes) throw new Error(`Computer ${field} must be at most ${maxBytes} bytes.`);
  return value;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
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
  const encoder = new TextEncoder();
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

export async function readComputerFileFromWorkspace(workspace: Pick<ComputerWorkspaceClient, "fs">, input: unknown) {
  const path = resolveComputerPath((input as { path?: unknown } | null)?.path);
  await ensureComputerHome(workspace.fs);
  const stat = await assertExistingPathIsSafe(workspace.fs, path);
  if (!stat?.isFile) throw new Error("Computer read requires a regular file.");
  if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > COMPUTER_READ_MAX_BYTES) {
    throw new Error(`Computer file exceeds the ${COMPUTER_READ_MAX_BYTES}-byte read limit.`);
  }
  const content = await workspace.fs.readFile(path, "utf8");
  const bytes = new TextEncoder().encode(content).byteLength;
  if (bytes > COMPUTER_READ_MAX_BYTES) throw new Error(`Computer file exceeds the ${COMPUTER_READ_MAX_BYTES}-byte read limit.`);
  return { path, content, bytes };
}

export async function writeComputerFileFromWorkspace(workspace: Pick<ComputerWorkspaceClient, "fs">, input: unknown) {
  const path = resolveComputerPath((input as { path?: unknown } | null)?.path);
  const content = requireBoundedString((input as { content?: unknown } | null)?.content, "content", COMPUTER_WRITE_MAX_BYTES);
  await prepareComputerParent(workspace.fs, path);
  const existing = await assertExistingPathIsSafe(workspace.fs, path, true);
  if (existing?.isDirectory) throw new Error("Computer write requires a file path.");
  await workspace.fs.writeFile(path, content);
  return { path, bytesWritten: new TextEncoder().encode(content).byteLength };
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

export async function grepComputerFilesFromWorkspace(workspace: Pick<ComputerWorkspaceClient, "fs">, input: unknown) {
  const values = input as { path?: unknown; query?: unknown; ignoreCase?: unknown } | null;
  const path = resolveComputerPath(values?.path ?? COMPUTER_HOME);
  const query = requireBoundedString(values?.query, "grep query", COMPUTER_GREP_MAX_PATTERN_LENGTH, false);
  await ensureComputerHome(workspace.fs);
  const stat = await assertExistingPathIsSafe(workspace.fs, path);
  if (!stat?.isDirectory && !stat?.isFile) throw new Error("Computer grep requires a file or directory.");
  const rawMatches = await workspace.fs.grep(query, path, { ignoreCase: values?.ignoreCase === true });
  const safeMatches: ComputerGrepMatch[] = [];
  for (const match of rawMatches) {
    if (safeMatches.length >= COMPUTER_GREP_MAX_MATCHES) break;
    const matchPath = resolveComputerPath(match.path);
    const matchStat = await assertExistingPathIsSafe(workspace.fs, matchPath);
    if (!matchStat?.isFile) continue;
    safeMatches.push({ path: matchPath, line: match.line, text: truncateUtf8(match.text, 512) });
  }
  const bounded = boundedItems(safeMatches, (match) => match);
  return { path, matches: bounded.items, truncated: bounded.truncated || safeMatches.length < rawMatches.length };
}

export async function computerHealthFromWorkspace(workspace: Pick<ComputerWorkspaceClient, "fs">) {
  const home = await lstatOrNull(workspace.fs, COMPUTER_HOME);
  return {
    ownerScoped: true,
    home: COMPUTER_HOME,
    storage: "durable-object-sqlite",
    executionBackends: [] as string[],
    homeReady: Boolean(home?.isDirectory && !home.isSymbolicLink),
  };
}
