import { CODE_DIFF_MAX_TEXT_BYTES, createCodeDiffReceipt, type CodeDiffReceipt } from "./code-diff";

const WORKSPACE_ROOT = "/home/user";
const CODE_DIFF_READ_MAX_BYTES = CODE_DIFF_MAX_TEXT_BYTES + 1;

export type CodeDiffReadRequest = {
  source: "workspace" | "machine";
  path: string;
};

type CodeDiffReadSide = "old" | "new";

type CodeDiffReaders = {
  readWorkspace: (path: string, maxBytes: number) => Promise<string | null>;
  readMachine: (path: string) => Promise<string | null>;
};

function inputObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("code diff input must be an object");
  return value as Record<string, unknown>;
}

function canonicalWorkspacePath(path: string, side: CodeDiffReadSide): string {
  const absolute = path.startsWith("/");
  const segments = path.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) throw new Error(`${side}.path must not contain traversal segments`);
  const canonicalSegments = segments.filter(Boolean);
  const relativeSegments = absolute
    ? canonicalSegments[0] === "home" && canonicalSegments[1] === "user"
      ? canonicalSegments.slice(2)
      : null
    : canonicalSegments;
  if (!relativeSegments || relativeSegments.length === 0) throw new Error(`${side}.path must identify a file inside ${WORKSPACE_ROOT}`);
  return `${WORKSPACE_ROOT}/${relativeSegments.join("/")}`;
}

function readRequest(value: unknown, side: CodeDiffReadSide): CodeDiffReadRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${side} must identify an authorized file read`);
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.every((key) => key === "source" || key === "path")) throw new Error(`${side} must contain only source and path`);
  if (input.source !== "workspace" && input.source !== "machine") throw new Error(`${side}.source must be workspace or machine`);
  if (typeof input.path !== "string") throw new Error(`${side}.path must be a file path`);
  const path = input.path.trim();
  if (!path || path.length > 1024 || /[\u0000-\u001F\u007F]/.test(path)) throw new Error(`${side}.path must be a safe file path`);
  return { source: input.source, path: input.source === "workspace" ? canonicalWorkspacePath(path, side) : path };
}

function displayInput(input: Record<string, unknown>) {
  const keys = Object.keys(input);
  if (!keys.every((key) => key === "old" || key === "new" || key === "path" || key === "title" || key === "language")) {
    throw new Error("code diff input contains unsupported fields");
  }
  return {
    path: input.path,
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.language === undefined ? {} : { language: input.language }),
  };
}

async function readVerifiedValue(request: CodeDiffReadRequest, readers: CodeDiffReaders): Promise<string> {
  const value = request.source === "workspace"
    ? await readers.readWorkspace(request.path, CODE_DIFF_READ_MAX_BYTES)
    : await readers.readMachine(request.path);
  if (typeof value !== "string") throw new Error(`${request.source} read did not return text`);
  return value;
}

export async function createVerifiedCodeDiffReceipt(value: unknown, readers: CodeDiffReaders): Promise<CodeDiffReceipt> {
  const input = inputObject(value);
  const old = readRequest(input.old, "old");
  const next = readRequest(input.new, "new");
  const [oldText, newText] = await Promise.all([
    readVerifiedValue(old, readers),
    readVerifiedValue(next, readers),
  ]);
  return createCodeDiffReceipt({
    ...displayInput(input),
    oldText,
    newText,
    source: { old: old.source, new: next.source },
  });
}
