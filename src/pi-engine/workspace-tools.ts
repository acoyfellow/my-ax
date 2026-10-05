import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";

export type ChatWorkspace = {
  exec(command: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listFiles(path: string): Promise<string[]>;
};

export const PI_EXEC_DEFAULT_TIMEOUT_MS = 120_000;
export const PI_EXEC_MAX_TIMEOUT_MS = 600_000;
const OUTPUT_LIMIT_CHARS = 30_000;

export function boundedExecTimeout(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) return PI_EXEC_DEFAULT_TIMEOUT_MS;
  return Math.min(Math.floor(requested), PI_EXEC_MAX_TIMEOUT_MS);
}

export function clipToolOutput(text: string): string {
  if (text.length <= OUTPUT_LIMIT_CHARS) return text;
  return `${text.slice(0, OUTPUT_LIMIT_CHARS)}\n[INCOMPLETE RESULT: ${text.length - OUTPUT_LIMIT_CHARS} more characters not shown]`;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text: clipToolOutput(text) }] };
}

export function chatWorkspaceExtension(workspace: () => Promise<ChatWorkspace>, instructions: string) {
  const exec = defineTool({
    name: "exec",
    description: "Run a shell command in this chat's own Linux workspace (home /home/user). Returns stdout, stderr and the exit code.",
    parameters: Type.Object({
      command: Type.String(),
      timeoutMs: Type.Optional(Type.Number()),
    }),
    execute: async (args) => {
      const result = await (await workspace()).exec(args.command, boundedExecTimeout(args.timeoutMs));
      return textResult(`exit ${result.exitCode}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
    },
  });
  const read = defineTool({
    name: "read_file",
    description: "Read a text file from this chat's workspace.",
    parameters: Type.Object({ path: Type.String() }),
    replay: "safe",
    execute: async (args) => textResult(await (await workspace()).readFile(args.path)),
  });
  const write = defineTool({
    name: "write_file",
    description: "Write a text file in this chat's workspace, creating parent folders.",
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    replay: "safe",
    execute: async (args) => {
      await (await workspace()).writeFile(args.path, args.content);
      return textResult(`wrote ${args.content.length} characters to ${args.path}`);
    },
  });
  const list = defineTool({
    name: "list_files",
    description: "List files under a folder in this chat's workspace.",
    parameters: Type.Object({ path: Type.String() }),
    replay: "safe",
    execute: async (args) => textResult((await (await workspace()).listFiles(args.path)).join("\n")),
  });
  return defineExtension({ name: "myax.workspace", sections: [section("myax", () => instructions)], tools: [exec, read, write, list] });
}
