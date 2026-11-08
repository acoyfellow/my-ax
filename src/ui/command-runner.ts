import type { BuiltinName, Command } from "../commands/registry";

export const COMMAND_EVENT = "my-ax:command";

export type CommandEventDetail = { name: BuiltinName; args: Record<string, string>; sessionId: string | null };

export function dispatchBuiltin(name: BuiltinName, args: Record<string, string>, sessionId: string | null): void {
  window.dispatchEvent(new CustomEvent<CommandEventDetail>(COMMAND_EVENT, { detail: { name, args, sessionId } }));
}

export type RunDeps = {
  sessionId: () => string | null;
  send: (text: string) => void;
  toast: (text: string, kind?: "info" | "error") => void;
  fetchJson: (path: string, init?: RequestInit) => Promise<{ ok?: boolean; result?: unknown; error?: { message?: string } }>;
};

async function post(deps: RunDeps, path: string, body: unknown) {
  return deps.fetchJson(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export async function runCommand(command: Command, args: Record<string, string>, rest: string, deps: RunDeps): Promise<void> {
  const action = command.action;
  if (action.type === "client") {
    dispatchBuiltin(action.name, args, deps.sessionId());
    return;
  }
  if (action.type === "recipe") {
    const sessionId = deps.sessionId();
    if (!sessionId) {
      deps.toast("Send a first message, then run tools in that conversation", "error");
      return;
    }
    const response = await post(deps, `/api/recipes/${encodeURIComponent(action.recipeId)}/run`, { sessionId, input: args });
    if (!response.ok) deps.toast(response.error?.message ?? `Could not run ${command.title}`, "error");
    else deps.toast(`Running ${command.title}. The receipt will appear in this conversation.`);
    return;
  }
  if (action.type === "skill") {
    deps.send(`/${command.trigger} ${[Object.entries(args).map(([key, value]) => `${key}:${value}`).join(" "), rest].filter(Boolean).join(" ")}`.trim());
    return;
  }
  if (action.type === "connector") {
    deps.send(`Use the ${command.title} tool${Object.keys(args).length ? ` with ${JSON.stringify(args)}` : ""}. ${rest}`.trim());
    return;
  }
  deps.send(`On my laptop, use the ${action.tool} tool${Object.keys(args).length ? ` with ${JSON.stringify(args)}` : ""}. ${rest}`.trim());
}
