export type ToolRowState = "running" | "ok" | "error";

export const TOOL_ROW_STATUS_LABEL: Readonly<Record<ToolRowState, string>> = { running: "Running", ok: "Done", error: "Failed" };

export function toolRowState(state: string): ToolRowState {
  if (state === "pending") return "running";
  if (state === "error") return "error";
  return "ok";
}

const SUMMARY_MAX = 72;

const PREFERRED_KEYS: Readonly<Record<string, readonly string[]>> = {
  work_code: ["reusableToolName", "name"],
  work_search: ["query"],
  web_search: ["query"],
  search_conversations: ["query"],
  browser_open: ["url"],
  read_file: ["path"],
  write_file: ["path"],
  edit_file: ["path"],
  edit: ["path"],
  write: ["path"],
  read: ["path"],
  ls: ["path"],
  list_directory: ["path"],
  find: ["pattern", "path"],
  grep: ["pattern", "path"],
  exec: ["command"],
  shell: ["command"],
  bash: ["command"],
  spawn_child: ["name", "task"],
  wait_child: ["childId"],
};

const GENERIC_KEYS = ["query", "url", "path", "file", "command", "cmd", "pattern", "name", "title", "task", "prompt", "message", "content", "text", "id"];

function oneLine(text: string): string {
  return text.replace(/\\n|\\r|\\t/g, " ").replace(/\s+/g, " ").trim();
}

function clip(text: string, max = SUMMARY_MAX): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const REUSABLE_MARKER = /(?:\/\/|#)\s*reusable(?:-tool)?\s*:\s*([\w.-]+)/i;
const TRIVIAL_CODE_LINE = /^(?:async\s*)?\(?\s*\)?\s*=>\s*\{?$|^async\s+function\b.*\{$|^function\b.*\{$|^[{}();,\s]*$|^\/\/|^#|^"use strict";?$|^return\s*;?$/;

export function codeHeadline(code: string): string {
  const marker = REUSABLE_MARKER.exec(code);
  if (marker) return marker[1];
  const lines = code.replace(/\\n/g, "\n").split("\n").map((line) => line.trim());
  const meaningful = lines.find((line) => line && !TRIVIAL_CODE_LINE.test(line));
  return meaningful ?? lines.find(Boolean) ?? "";
}

function stringField(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

export function toolArgSummary(name: string, args: unknown): string {
  if (typeof args === "string") return clip(oneLine(args));
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const record = args as Record<string, unknown>;
  for (const key of PREFERRED_KEYS[name] ?? []) {
    const value = stringField(record, key);
    if (value) return clip(oneLine(value));
  }
  const code = stringField(record, "code");
  if (code) return clip(oneLine(codeHeadline(code)));
  for (const key of GENERIC_KEYS) {
    const value = stringField(record, key);
    if (value) return clip(oneLine(value));
  }
  const first = Object.values(record).find((value) => typeof value === "string" && value.trim()) as string | undefined;
  return first ? clip(oneLine(first)) : "";
}

export type ToolArgField = { key: string; value: string; block: boolean };

export function toolArgFields(args: unknown): ToolArgField[] {
  if (args === undefined || args === null) return [];
  if (typeof args !== "object" || Array.isArray(args)) return [{ key: "input", value: formatValue(args), block: true }];
  return Object.entries(args as Record<string, unknown>).map(([key, value]) => {
    const text = formatValue(value);
    return { key, value: text, block: text.includes("\n") || text.length > 60 };
  });
}

export function formatValue(value: unknown): string {
  if (typeof value === "string") return unescapeIfEscaped(value);
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function unescapeIfEscaped(text: string): string {
  if (text.includes("\n") || !/\\n/.test(text)) return text;
  return text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, "\"");
}

export function formatToolResult(result: unknown): string {
  if (typeof result !== "string") return formatValue(result);
  const trimmed = result.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return prettyJsonWithRealNewlines(JSON.parse(trimmed));
    } catch {}
  }
  return unescapeIfEscaped(result);
}

function prettyJsonWithRealNewlines(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    const multiline = entries.filter(([, field]) => typeof field === "string" && field.includes("\n"));
    if (multiline.length) {
      const rest = Object.fromEntries(entries.filter(([, field]) => !(typeof field === "string" && field.includes("\n"))));
      const head = Object.keys(rest).length ? `${JSON.stringify(rest, null, 2)}\n\n` : "";
      return head + multiline.map(([key, field]) => `${key}:\n${field as string}`).join("\n\n");
    }
  }
  return JSON.stringify(value, null, 2);
}
