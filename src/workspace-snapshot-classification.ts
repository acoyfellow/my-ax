const READ_ONLY_TOOL_NAMES = new Set<string>([
  "read_file",
  "work_search",
  "show_diff",
  "search_files",
  "list_directory",
  "process_status",
  "process_logs",
  "process_cancel",
  "search_conversations",
  "notify_owner",
  "create_svelte_artifact",
  "list_preview_services",
  "preview_service",
  "close_preview_service",
  "think",
]);

const SANDBOX_READ_ONLY_WORKSPACE_METHODS = new Set<string>([
  "read",
  "list",
  "search",
  "process_status",
  "process_logs",
  "process_cancel",
]);

type WorkCodeCall = {
  where?: unknown;
  method?: unknown;
};

function parseWorkCodeCalls(output: unknown): WorkCodeCall[] | null {
  let value = output;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const calls = (value as { calls?: unknown }).calls;
  return Array.isArray(calls) ? calls as WorkCodeCall[] : null;
}

export function shouldSnapshotSandboxForToolCall(toolName: string, output: unknown): boolean {
  if (READ_ONLY_TOOL_NAMES.has(toolName)) return false;
  if (toolName !== "work_code") return true;
  const calls = parseWorkCodeCalls(output);
  if (!calls) return true;
  return calls.some((call) =>
    call.where === "workspace"
    && typeof call.method === "string"
    && !SANDBOX_READ_ONLY_WORKSPACE_METHODS.has(call.method),
  );
}
