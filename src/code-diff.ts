import { MODEL_TOOL_OUTPUT_LIMIT_BYTES } from "./model-tool-output-limit";

export const CODE_DIFF_MAX_TEXT_BYTES = 64_000;
export const CODE_DIFF_MAX_TOTAL_BYTES = 20_000;
export const CODE_DIFF_MAX_PATH_CHARS = 240;
export const CODE_DIFF_MAX_TITLE_CHARS = 160;
export const CODE_DIFF_MAX_LANGUAGE_CHARS = 48;

const SOURCE_KINDS = new Set(["workspace", "machine", "user", "generated"]);
const CODE_DIFF_KEYS = new Set(["kind", "version", "path", "title", "language", "oldText", "newText", "source"]);

export type CodeDiffSource = {
  old: "workspace" | "machine" | "user" | "generated";
  new: "workspace" | "machine" | "user" | "generated";
};

export type CodeDiffReceipt = {
  kind: "code-diff";
  version: 1;
  path: string;
  title: string;
  language?: string;
  oldText: string;
  newText: string;
  source: CodeDiffSource;
};

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isBinaryText(value: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

function requiredText(input: Record<string, unknown>, key: "oldText" | "newText"): string {
  const value = input[key];
  if (typeof value !== "string") throw new Error(`${key} is required`);
  if (isBinaryText(value)) throw new Error(`${key} must be text, not binary data`);
  if (byteLength(value) > CODE_DIFF_MAX_TEXT_BYTES) throw new Error(`${key} must be <= ${CODE_DIFF_MAX_TEXT_BYTES} bytes`);
  return value;
}

function safeRelativePath(value: unknown): string {
  if (typeof value !== "string") throw new Error("path is required");
  const path = value.trim();
  if (!path || path.length > CODE_DIFF_MAX_PATH_CHARS) throw new Error(`path must be 1-${CODE_DIFF_MAX_PATH_CHARS} characters`);
  if (path.startsWith("/") || path.includes("\\") || path.includes("\u0000") || /[\u0001-\u001F\u007F]/.test(path)) throw new Error("path must be a safe relative path");
  if (path.split("/").some((part) => part === "" || part === "." || part === "..")) throw new Error("path must not contain empty, current, or parent segments");
  if (/[<>]/.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path)) throw new Error("path must be display-only relative text");
  return path;
}

function safeTitle(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Error("title must be text");
  const title = value.trim();
  if (!title || title.length > CODE_DIFF_MAX_TITLE_CHARS) throw new Error(`title must be 1-${CODE_DIFF_MAX_TITLE_CHARS} characters`);
  if (/[\u0000-\u001F\u007F<>]/.test(title) || /^[a-z][a-z0-9+.-]*:/i.test(title)) throw new Error("title must be safe display text");
  return title;
}

function safeLanguage(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("language must be text");
  const language = value.trim();
  if (!language || language.length > CODE_DIFF_MAX_LANGUAGE_CHARS || !/^[a-z0-9+_.-]+$/i.test(language)) throw new Error("language must be a safe identifier");
  return language;
}

function sourceKind(value: unknown, key: "old" | "new"): CodeDiffSource[typeof key] {
  if (typeof value !== "string" || !SOURCE_KINDS.has(value)) throw new Error(`source.${key} must be an authorized text source`);
  return value as CodeDiffSource[typeof key];
}

function safeSource(value: unknown): CodeDiffSource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("source metadata is required");
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source);
  if (keys.length !== 2 || !keys.every((key) => key === "old" || key === "new")) throw new Error("source metadata must contain only old and new");
  return { old: sourceKind(source.old, "old"), new: sourceKind(source.new, "new") };
}

function inputObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("code diff input must be an object");
  return value as Record<string, unknown>;
}

function boundedReceipt(receipt: CodeDiffReceipt): CodeDiffReceipt {
  if (byteLength(JSON.stringify(receipt)) > MODEL_TOOL_OUTPUT_LIMIT_BYTES) {
    throw new Error(`serialized code diff must be <= ${MODEL_TOOL_OUTPUT_LIMIT_BYTES} bytes`);
  }
  return receipt;
}

export function createCodeDiffReceipt(value: unknown): CodeDiffReceipt {
  const input = inputObject(value);
  const oldText = requiredText(input, "oldText");
  const newText = requiredText(input, "newText");
  if (oldText.length === 0 && newText.length === 0) throw new Error("oldText and newText cannot both be empty");
  if (byteLength(oldText) + byteLength(newText) > CODE_DIFF_MAX_TOTAL_BYTES) throw new Error(`combined diff text must be <= ${CODE_DIFF_MAX_TOTAL_BYTES} bytes`);
  const path = safeRelativePath(input.path);
  const title = safeTitle(input.title, path);
  const language = safeLanguage(input.language);
  const source = safeSource(input.source);
  return boundedReceipt({ kind: "code-diff", version: 1, path, title, ...(language ? { language } : {}), oldText, newText, source });
}

export function parseCodeDiffReceipt(value: unknown): CodeDiffReceipt | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const receipt = value as Record<string, unknown>;
  const keys = Object.keys(receipt);
  if (!keys.every((key) => CODE_DIFF_KEYS.has(key))) return null;
  if (receipt.kind !== "code-diff" || receipt.version !== 1 || !("path" in receipt) || !("title" in receipt) || !("oldText" in receipt) || !("newText" in receipt) || !("source" in receipt)) return null;
  try {
    const parsed = createCodeDiffReceipt(receipt);
    if (parsed.title !== receipt.title || parsed.path !== receipt.path || parsed.oldText !== receipt.oldText || parsed.newText !== receipt.newText) return null;
    if (parsed.language !== receipt.language) return null;
    return parsed;
  } catch {
    return null;
  }
}
