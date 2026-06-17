import { jsonSchema, tool, type Tool, type ToolSet } from "ai";
import type { ToolDef, ToolContext } from "./types";
import { createDecision } from "./routes/decisions";
import { WORK_CODE_TOOL, WORK_SEARCH_TOOL } from "./work-tools";

export const ASK_USER_TOOL: ToolDef = {
  name: "ask_user",
  description: "Ask the owner a single multiple-choice question and pause for their answer. Creates an interactive decision widget, sends a push notification deep-linking to it, and records the decision. Use this when you genuinely need a human choice (approval, selection, direction) before continuing — especially if the user may be away. After calling this, stop and wait; the user's choice arrives as a new message in this conversation.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "The single question to ask." },
      options: { type: "array", items: { type: "string" }, description: "2-4 short answer choices." },
    },
    required: ["question", "options"],
  },
  execute: async (args, ctx) => {
    const question = typeof args.question === "string" ? args.question.trim() : "";
    const options = Array.isArray(args.options) ? args.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 4) : [];
    if (!question) return JSON.stringify({ ok: false, error: "question is required" });
    if (options.length < 2) return JSON.stringify({ ok: false, error: "at least two options are required" });
    const decision = await createDecision(ctx.env, ctx.identity.email.toLowerCase(), ctx.sessionId, question, options);
    await ctx.notifyOwner({ kind: "job.needs_input", title: "My AX needs your input", body: question.slice(0, 160), href: decision.href }).catch(() => undefined);
    return JSON.stringify({ ok: true, awaiting: true, decisionId: decision.id, href: decision.href, options, note: "Stop and wait. The owner's choice will arrive as a new user message." });
  },
};

export const TOOLS: ToolDef[] = [
  ASK_USER_TOOL,
  WORK_SEARCH_TOOL,
  WORK_CODE_TOOL,
  {
    name: "shell_exec",
    description: "Execute a quick, bounded shell command and return stdout/stderr. Use for fast commands like curl probes, jq, grep, or small scripts. For installs, builds/tests likely to run for a while, dev servers, watchers, or anything that may keep running, use process_start + process_status/process_logs instead. Commands run in a sandboxed environment. NOTE: For services behind upstream auth, use the connected MCP tools (Settings → Connectors) — shell_exec cannot reach behind access control.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        cwd: { type: "string", description: "Working directory (default: current workspace)" },
        timeout: { type: "number", description: "Timeout in ms (default: 30000)" },
      },
      required: ["command"],
    },
    execute: async (args, ctx) => {
      const command = args.command as string;
      const cwdArg = args.cwd as string | undefined;
      const cwd = cwdArg ?? ctx.workingDirectory;
      const timeout = (args.timeout as number) ?? 30000;

      const result = await ctx.shellExec(command, { cwd, cwdExplicit: cwdArg !== undefined, timeout });

      let output = "";
      if (result.stdout) output += result.stdout;
      if (result.stderr) output += (output ? "\n--- stderr ---\n" : "") + result.stderr;
      if (!output) output = "(no output)";

      const MAX = 10000;
      if (output.length > MAX) {
        output = output.slice(0, MAX) + `\n... (truncated, ${output.length - MAX} chars omitted)`;
      }

      return `Exit code: ${result.exitCode}\n${output}`;
    },
  },
  {
    name: "read_file",
    description: "Read the contents of a file. Returns the file content with line numbers.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to read" },
        max_lines: { type: "number", description: "Maximum lines to return (default: 500)" },
      },
      required: ["path"],
    },
    execute: async (args, ctx) => {
      const path = args.path as string;
      const maxLines = (args.max_lines as number) ?? 500;

      try {
        const content = await ctx.readFile(path);
        const lines = content.split("\n");

        if (lines.length > maxLines) {
          const shown = lines.slice(0, maxLines).map((l, i) => `${i + 1}: ${l}`).join("\n");
          return `${shown}\n... (${lines.length - maxLines} more lines, use max_lines to see more)`;
        }

        return lines.map((l, i) => `${i + 1}: ${l}`).join("\n");
      } catch (err) {
        return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    name: "write_file",
    description: "Write content to a file. Creates the file and any parent directories if they don't exist.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to write to" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["path", "content"],
    },
    execute: async (args, ctx) => {
      const path = args.path as string;
      const content = args.content as string;

      try {
        await ctx.writeFile(path, content);
        const lines = content.split("\n").length;
        return `Wrote ${content.length} bytes (${lines} lines) to ${path}`;
      } catch (err) {
        return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  },
  {
    name: "search_files",
    description: "Search for a pattern in workspace files and return matching lines with paths and line numbers. Pass a specific directory for project searches; path omitted or /home/user searches the workspace root.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Search pattern (regex)" },
        path: { type: "string", description: "Directory to search in (default: workspace root)" },
        include: { type: "string", description: "File glob pattern, e.g. '*.ts'" },
      },
      required: ["pattern"],
    },
    execute: async (args, ctx) => {
      const pattern = args.pattern as string;
      const requestedPath = (args.path as string) ?? ".";
      const searchPath = requestedPath === "." ? "/home/user" : requestedPath;
      const include = args.include as string | undefined;
      const files = await ctx.listFiles(searchPath, { recursive: true, includeHidden: true });
      const matcher = new RegExp(pattern, "i");
      const suffix = include?.replace(/^\*\.?/, ".");
      const hits: string[] = [];
      for (const file of files.slice(0, 250)) {
        const path = file.path;
        if (!path || file.type === "directory") continue;
        if (suffix && !path.endsWith(suffix)) continue;
        try {
          const content = await ctx.readFile(path);
          for (const [i, line] of content.split("\n").entries()) {
            if (!matcher.test(line)) continue;
            hits.push(`${path}:${i + 1}:${line}`);
            if (hits.length >= 50) return hits.join("\n");
          }
        } catch {
          // Unreadable/binary files are skipped just like grep stderr was.
        }
      }
      return hits.join("\n") || "No matches found.";
    },
  },
  {
    name: "list_directory",
    description: "List contents of a workspace directory. Recursive listing is supported and output is capped for chat readability.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path to list" },
        recursive: { type: "boolean", description: "List recursively (default: false, limited to 3 levels)" },
      },
      required: ["path"],
    },
    execute: async (args, ctx) => {
      const path = args.path as string;
      const recursive = args.recursive as boolean ?? false;
      const files = await ctx.listFiles(path, { recursive, includeHidden: true });
      if (files.length === 0) return "Directory is empty or does not exist.";
      return files
        .slice(0, 100)
        .map((file) => `${file.type ?? "file"}\t${file.size ?? ""}\t${file.path}`)
        .join("\n");
    },
  },
  {
    name: "process_start",
    description: "Start a long-running sandbox process and return its process id immediately. Use for npm/bun/pnpm installs, builds/tests that may exceed a short shell call, dev servers, watchers, or anything you want to monitor later. Poll with process_status and read logs with process_logs; stop with process_cancel.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to start in the sandbox" },
        cwd: { type: "string", description: "Working directory (default: current workspace)" },
        timeout: { type: "number", description: "Maximum process runtime in ms, if a cap is desired" },
        process_id: { type: "string", description: "Optional stable process id for later lookup" },
      },
      required: ["command"],
    },
    execute: async (args, ctx) => {
      const cwdArg = args.cwd as string | undefined;
      const process = await ctx.processStart(args.command as string, {
        cwd: cwdArg ?? ctx.workingDirectory,
        cwdExplicit: cwdArg !== undefined,
        timeout: args.timeout as number | undefined,
        processId: args.process_id as string | undefined,
      });
      return `Started process ${process.id}\nStatus: ${process.status}\nCommand: ${process.command}${process.pid ? `\nPID: ${process.pid}` : ""}`;
    },
  },
  {
    name: "process_status",
    description: "Get the current status of a sandbox background process previously returned by process_start.",
    parameters: {
      type: "object",
      properties: {
        process_id: { type: "string", description: "Process id returned by process_start" },
      },
      required: ["process_id"],
    },
    execute: async (args, ctx) => {
      const process = await ctx.processStatus(args.process_id as string);
      if (!process) return `Process ${args.process_id as string} was not found.`;
      return [
        `Process: ${process.id}`,
        `Status: ${process.status}`,
        `Command: ${process.command}`,
        process.pid ? `PID: ${process.pid}` : "",
        process.exitCode !== undefined ? `Exit code: ${process.exitCode}` : "",
        `Started: ${process.startTime}`,
        process.endTime ? `Ended: ${process.endTime}` : "",
      ].filter(Boolean).join("\n");
    },
  },
  {
    name: "process_logs",
    description: "Read accumulated stdout and stderr for a sandbox background process. Output is truncated to keep the chat usable.",
    parameters: {
      type: "object",
      properties: {
        process_id: { type: "string", description: "Process id returned by process_start" },
      },
      required: ["process_id"],
    },
    execute: async (args, ctx) => {
      const logs = await ctx.processLogs(args.process_id as string);
      if (!logs) return `Process ${args.process_id as string} was not found.`;
      let output = logs.stdout || "";
      if (logs.stderr) output += `${output ? "\n--- stderr ---\n" : ""}${logs.stderr}`;
      if (!output) output = "(no output yet)";
      const MAX = 10000;
      if (output.length > MAX) output = `... (showing last ${MAX} of ${output.length} chars)\n` + output.slice(-MAX);
      return `Logs for ${logs.processId}:\n${output}`;
    },
  },
  {
    name: "process_cancel",
    description: "Stop a sandbox background process previously returned by process_start.",
    parameters: {
      type: "object",
      properties: {
        process_id: { type: "string", description: "Process id returned by process_start" },
        signal: { type: "string", description: "Optional POSIX signal, default SIGTERM" },
      },
      required: ["process_id"],
    },
    execute: async (args, ctx) => {
      const stopped = await ctx.processCancel(args.process_id as string, args.signal as string | undefined);
      return stopped ? `Stopped process ${args.process_id as string}.` : `Process ${args.process_id as string} was not found.`;
    },
  },
  {
    name: "search_conversations",
    description: "Search the user's prior my-ax conversation history using the D1 full-text memory index. Use this when they ask what you discussed before, or to find past context. Do not grep filesystem conversation logs.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Full-text query" },
        limit: { type: "number", description: "Maximum results, default 20, max 100" },
      },
      required: ["query"],
    },
    execute: async (args, ctx) => {
      const rows = await ctx.searchConversations(args.query as string, args.limit as number | undefined);
      if (!rows.length) return "No matching prior conversations found.";
      return rows.map((row) => `${row.ts}\t${row.sessionId}\t${row.role}\t${row.snippet}`).join("\n");
    },
  },
  {
    name: "notify_owner",
    description: "Send an attention notification to this user's subscribed my-ax installed apps. Use only when the user explicitly asks to be notified, or for a completed/background task or important action requiring their attention. Never use for routine chat replies. Delivery is always restricted to the current owner.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["session.update", "job.complete", "job.needs_input", "watch.fired", "deploy.gate"], description: "Why the user needs attention" },
        title: { type: "string", description: "Short notification title" },
        body: { type: "string", description: "Short notification body; no secrets" },
        href: { type: "string", description: "Optional same-origin app deep link" },
      },
      required: ["kind", "title", "body"],
    },
    execute: async (args, ctx) => {
      const receipt = await ctx.notifyOwner({
        kind: args.kind as "session.update" | "job.complete" | "job.needs_input" | "watch.fired" | "deploy.gate",
        title: args.title as string,
        body: args.body as string,
        href: args.href as string | undefined,
      });
      const failures = receipt.failures?.length
        ? `; failure details: ${receipt.failures.map((f) => `${f.host}${f.status ? ` ${f.status}` : ""} ${f.reason}`.trim()).join(", ")}`
        : "";
      return `Notification delivery: ${receipt.delivered}/${receipt.devices} device(s) accepted${receipt.expired ? `; ${receipt.expired} expired subscription(s) removed` : ""}${receipt.failed ? `; ${receipt.failed} failed` : ""}${failures}.`;
    },
  },
  {
    name: "create_svelte_artifact",
    description: "Create one durable interactive Svelte 5 artifact attached to this conversation and rendered inline in chat. Use when the user asks for a widget, visualization, dashboard, interactive explainer, calculator, or other useful UI artifact. Each call creates a new one-off artifact: do not treat this as a revision workflow. Source must be a complete self-contained .svelte component using Svelte 5 runes and no external imports. The artifact runs in a sandboxed iframe with no owner credentials; only the Svelte runtime module CDN required to mount it is permitted.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short human-readable artifact title" },
        source: { type: "string", description: "Complete self-contained Svelte 5 component source; no external imports" },
      },
      required: ["title", "source"],
    },
    execute: async (args, ctx) => JSON.stringify(await ctx.createSvelteArtifact({ title: args.title as string, source: args.source as string })),
  },
  {
    name: "run_code",
    description: "Run JavaScript or TypeScript in the user's cloud Sandbox code interpreter. Use for bounded computations, data transforms, and JSON-producing analysis. This is richer than shell_exec for code snippets because it returns structured interpreter results. Python is intentionally not offered by the lean production sandbox image.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Code to execute" },
        language: { type: "string", enum: ["javascript", "typescript"], description: "Interpreter language (default javascript)" },
        timeout: { type: "number", description: "Timeout in milliseconds, default 60000" },
      },
      required: ["code"],
    },
    execute: async (args, ctx) => JSON.stringify(await ctx.runCode(args.code as string, { language: (args.language as "javascript" | "typescript" | undefined) ?? "javascript", timeout: args.timeout as number | undefined }), null, 2),
  },
  {
    name: "preview_service",
    description: "Expose a local HTTP service from the user's cloud Sandbox through a temporary public trycloudflare preview URL. Use after starting a dev server with process_start. Same port returns the existing tunnel; URL changes after container restart.",
    parameters: {
      type: "object",
      properties: { port: { type: "number", description: "Local TCP port, e.g. 3000 or 5173" } },
      required: ["port"],
    },
    execute: async (args, ctx) => JSON.stringify(await ctx.tunnelGet(args.port as number), null, 2),
  },
  {
    name: "list_preview_services",
    description: "List active temporary public preview tunnels for services running in the user's cloud Sandbox.",
    parameters: { type: "object", properties: {} },
    execute: async (_args, ctx) => JSON.stringify(await ctx.tunnelList(), null, 2),
  },
  {
    name: "close_preview_service",
    description: "Stop a temporary public preview tunnel for a cloud Sandbox service.",
    parameters: { type: "object", properties: { port: { type: "number" } }, required: ["port"] },
    execute: async (args, ctx) => { await ctx.tunnelDestroy(args.port as number); return `Closed preview tunnel for port ${args.port}.`; },
  },
];

/**
 * Expose the existing my-ax domain tools through the AI SDK execution shape
 * expected by Think. Tool semantics remain unchanged; this adapter is the
 * bridge that lets the new runtime use the same Sandbox and connector code.
 */
const MODEL_TOOL_NAMES = new Set([
  "ask_user",
  "work_search",
  "work_code",
  "search_conversations",
  "notify_owner",
  "create_svelte_artifact",
]);

export function createThinkTools(context: () => ToolContext): ToolSet {
  const tools: Record<string, Tool<Record<string, unknown>, string>> = {};
  for (const definition of TOOLS) {
    if (!MODEL_TOOL_NAMES.has(definition.name)) continue;
    tools[definition.name] = tool<Record<string, unknown>, string>({
      description: definition.description,
      inputSchema: jsonSchema<Record<string, unknown>>(definition.parameters as Parameters<typeof jsonSchema>[0]),
      execute: async (input: Record<string, unknown>) => definition.execute(input ?? {}, context()),
    });
  }
  return tools as ToolSet;
}
