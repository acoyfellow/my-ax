import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { WorkspaceDirectory } from "../workspace-directory";

function textResult(value: unknown) {
  return { output: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

export function siblingWorkspaceExtension(directory: () => WorkspaceDirectory, selfId: () => string) {
  const list = defineTool({
    name: "workspace_list",
    description: "List the owner's other workspaces (chats and the owner workspace) that this chat can message or share files with.",
    parameters: Type.Object({ limit: Type.Optional(Type.Number()) }),
    replay: "safe",
    execute: async (args) => textResult(await directory().list(args.limit ?? 50)),
  });
  const message = defineTool({
    name: "workspace_message",
    description: "Send a message to another chat workspace owned by the same person. It arrives as a new turn in that chat.",
    parameters: Type.Object({ to: Type.String(), text: Type.String() }),
    execute: async (args) => textResult(await directory().message(selfId(), args.to, args.text)),
  });
  const read = defineTool({
    name: "workspace_read_file",
    description: "Read a text file under /home/user in another workspace owned by the same person.",
    parameters: Type.Object({ workspace: Type.String(), path: Type.String() }),
    replay: "safe",
    execute: async (args) => textResult(await directory().readFile(args.workspace, args.path)),
  });
  const write = defineTool({
    name: "workspace_write_file",
    description: "Write a text file under /home/user in another workspace owned by the same person.",
    parameters: Type.Object({ workspace: Type.String(), path: Type.String(), content: Type.String() }),
    replay: "safe",
    execute: async (args) => textResult(await directory().writeFile(args.workspace, args.path, args.content)),
  });
  return defineExtension({ name: "myax.siblings", tools: [list, message, read, write] });
}
