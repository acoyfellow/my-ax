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

export type WorkCodeCall = {
  where?: unknown;
  method?: unknown;
};

type WorkCodeReceipt = {
  calls?: unknown;
  sandboxMutation?: unknown;
  codemodeInvoked?: unknown;
  callsTruncated?: unknown;
};

export function summarizeWorkCodeSnapshot(calls: readonly WorkCodeCall[]) {
  return {
    sandboxMutation: calls.some((call) =>
      call.where === "workspace"
      && typeof call.method === "string"
      && !SANDBOX_READ_ONLY_WORKSPACE_METHODS.has(call.method),
    ),
    codemodeInvoked: calls.some((call) => call.where === "codemode"),
  };
}

function parseWorkCodeReceipt(output: unknown): WorkCodeReceipt | null {
  let value = output;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" ? value as WorkCodeReceipt : null;
}

function hasSnapshotMetadata(receipt: WorkCodeReceipt): boolean {
  return "sandboxMutation" in receipt || "codemodeInvoked" in receipt || "callsTruncated" in receipt;
}

function hasValidSnapshotMetadata(receipt: WorkCodeReceipt): boolean {
  return typeof receipt.sandboxMutation === "boolean"
    && typeof receipt.codemodeInvoked === "boolean"
    && typeof receipt.callsTruncated === "boolean";
}

export function shouldSnapshotSandboxForToolCall(toolName: string, output: unknown): boolean {
  if (READ_ONLY_TOOL_NAMES.has(toolName)) return false;
  if (toolName !== "work_code") return true;
  const receipt = parseWorkCodeReceipt(output);
  if (!receipt) return true;
  if (hasSnapshotMetadata(receipt) && !hasValidSnapshotMetadata(receipt)) return true;
  if (receipt.sandboxMutation === true || receipt.codemodeInvoked === true || receipt.callsTruncated === true) return true;
  const calls = receipt.calls;
  if (!Array.isArray(calls)) return true;
  const snapshot = summarizeWorkCodeSnapshot(calls);
  return snapshot.sandboxMutation || snapshot.codemodeInvoked;
}
