import type { AccessIdentity } from "./auth";
import type { Env, ToolContext } from "./types";
import type { WorkspaceScope } from "./workspace-policy";
import type { WorkCodeExecutionState } from "./computer-work-budget";
import { observeSessionTurns } from "./observe";
import { recentObserveEvents } from "./observe-events";
import { buildConversationSearchQuery } from "./conversation-search";
import { workspaceShellExec } from "./workspace-exec";
import { SandboxThinkWorkspace } from "./think-workspace";
import { getUserWorkspace, userWorkspaceAccess, WORKSPACE_HOME } from "./workspace";
import { acquireWithOneReset, useWorkspace } from "./workspace-access";
import { readBoundedWorkspaceFile } from "./workspace-read";
import { notifyOwner } from "./notify";
import { createSvelteArtifact, readOwnedSvelteArtifact, searchOwnedArtifacts } from "./artifacts";
import { createAudioMessage } from "./audio-messages";
import { SavedRecipeService, hasRetiredRecipeCapability } from "./saved-recipes";
import { listSnippetsDualRead } from "./cm-snippets";
import { resolveBridgeOrigin } from "./bridge-origin";

export type ToolContextHost = {
  env: Env;
  identity: AccessIdentity;
  sessionId: string;
  scope: WorkspaceScope;
  sandboxOnly: boolean;
  broadcast: (message: string) => void;
  callPage?: (verb: string, args?: Record<string, unknown>, opts?: { timeoutMs?: number }) => Promise<unknown>;
  runSavedRecipe: (body: { recipeId: string; input: Record<string, unknown>; callerCapabilities?: string[]; workCodeExecutionState?: WorkCodeExecutionState }) => Promise<unknown>;
  onRecipeUsed?: (usage: { recipeId: string; name: string | null; codemodeExecutionId: string | null }) => void;
};

export function createToolContext(host: ToolContextHost): ToolContext {
  const { env, identity, sessionId, scope, sandboxOnly } = host;
  const workingDirectory = WORKSPACE_HOME;
  const access = userWorkspaceAccess(env, identity, scope);
  return {
      workingDirectory,
      sandboxOnly,
      notifyOwner: (input) => notifyOwner(env, identity.email, { ...input, sessionId }),
      shellExec: (cmd, opts) => workspaceShellExec(async () => { await acquireWithOneReset(access); return getUserWorkspace(env, identity, { scope }); }, cmd, { cwd: opts?.cwd ?? workingDirectory, timeout: opts?.timeout ?? 30_000, env: { ACCESS_EMAIL: identity.email, XDG_CONFIG_HOME: "/home/user/.config", ...opts?.env } }),
      processStart: async (cmd, opts) => {
        const process = await useWorkspace(access, "side-effecting", (sandbox) => sandbox.startProcess(cmd, { cwd: opts?.cwd ?? workingDirectory, timeout: opts?.timeout, processId: opts?.processId, autoCleanup: false, env: { ACCESS_EMAIL: identity.email, XDG_CONFIG_HOME: "/home/user/.config", ...opts?.env } }));
        return { id: process.id, pid: process.pid, command: process.command, status: process.status, startTime: process.startTime.toISOString(), endTime: process.endTime?.toISOString(), exitCode: process.exitCode, sessionId: process.sessionId };
      },
      processStatus: async (id) => {
        const sandbox = await acquireWithOneReset(access);
        const process = await sandbox.getProcess(id);
        if (!process) return null;
        await process.getStatus();
        const current = (await sandbox.getProcess(id)) ?? process;
        return { id: current.id, pid: current.pid, command: current.command, status: current.status, startTime: current.startTime.toISOString(), endTime: current.endTime?.toISOString(), exitCode: current.exitCode, sessionId: current.sessionId };
      },
      processLogs: async (id) => {
        const sandbox = await acquireWithOneReset(access);
        const process = await sandbox.getProcess(id);
        if (!process) return null;
        const logs = await sandbox.getProcessLogs(id);
        return { processId: logs.processId, stdout: logs.stdout ?? "", stderr: logs.stderr ?? "" };
      },
      processCancel: async (id, signal) => {
        const sandbox = await acquireWithOneReset(access);
        if (!(await sandbox.getProcess(id))) return false;
        await sandbox.killProcess(id, signal ?? "SIGTERM");
        return true;
      },
      runCode: async (code, options) => useWorkspace(access, "side-effecting", async (sandbox) => {
        const context = await sandbox.createCodeContext({ language: options?.language ?? "python", cwd: workingDirectory });
        return sandbox.runCode(code, { context, timeout: options?.timeout, envVars: { ACCESS_EMAIL: identity.email, XDG_CONFIG_HOME: "/home/user/.config" } });
      }),
      tunnelGet: async (port) => {
        const sandbox = await acquireWithOneReset(access);
        return sandbox.tunnels.get(port);
      },
      tunnelList: async () => {
        const sandbox = await acquireWithOneReset(access);
        return sandbox.tunnels.list();
      },
      tunnelDestroy: async (port) => {
        const sandbox = await acquireWithOneReset(access);
        await sandbox.tunnels.destroy(port);
      },
      readFile: async (path, options) => {
        const maxBytes = options?.maxBytes;
        if (maxBytes === undefined) return new SandboxThinkWorkspace(env, () => identity, scope).readFile(path);
        return useWorkspace(access, "idempotent", (sandbox) => readBoundedWorkspaceFile(sandbox, path, maxBytes));
      },
      writeFile: async (path, content) => new SandboxThinkWorkspace(env, () => identity, scope).writeFile(path, content),
      listFiles: async (path, opts) => {
        const result = await useWorkspace(access, "idempotent", (sandbox) => sandbox.listFiles(path, opts));
        return result.files.map((file) => ({ path: file.absolutePath, name: file.name, type: file.type, size: file.size }));
      },
      observeTurns: (sessionId, turns) => observeSessionTurns(env.DB, identity.email, sessionId, turns),
      observeRecent: (options) => recentObserveEvents(env.DB, identity.email, options),
      searchConversations: async (query, options) => {
        const built = buildConversationSearchQuery(query, identity.email, options);
        if (!built) return [];
        const result = await env.DB.prepare(built.sql).bind(...built.params).all<{ sessionId: string; ts: string; role: string; snippet: string }>();
        return result.results ?? [];
      },
      searchArtifacts: (query, limit = 10) => searchOwnedArtifacts(env, identity, query, limit),
      getArtifact: async (id) => {
        const manifest = await readOwnedSvelteArtifact(env, identity, id);
        if (!manifest) return null;
        return { id: manifest.id, title: manifest.title, source: manifest.source, sourceHash: manifest.sourceHash, createdAt: manifest.createdAt };
      },
      createSvelteArtifact: (input) => createSvelteArtifact(env, identity, sessionId, input),
      sendVoiceMessage: async (input) => {
        const clip = await createAudioMessage(env, identity, sessionId, input);
        await notifyOwner(env, identity.email, {
          kind: "session.update",
          sessionId,
          title: "my · ax voice message",
          body: clip.title,
          href: `/?session=${encodeURIComponent(sessionId)}`,
        }).catch((error) => console.error("voice_message_push_failed", { sessionId, err: error instanceof Error ? error.message : String(error) }));
        return clip;
      },
      listSavedRecipes: async () => {
        const snippets = await listSnippetsDualRead(env, identity.email);
        const recipes = await new SavedRecipeService(env, identity.email).list();
        const recipeByName = new Map(recipes.filter((r) => r.status === "enabled").map((r) => [r.name, r] as const));
        return snippets.flatMap((snippet) => {
          const recipe = recipeByName.get(snippet.name);
          const capabilities = recipe?.capabilities ?? snippet.capabilities;
          if (hasRetiredRecipeCapability(capabilities)) return [];
          return [{
            id: snippet.sourceRecipeId ?? snippet.id,
            name: snippet.name,
            description: snippet.description,
            inputSchema: snippet.inputSchema,
            capabilities,
            codemodeExecutionId: snippet.codemodeExecutionId,
            sourceRecipeId: snippet.sourceRecipeId,
            provenance: snippet.provenance,
          }];
        });
      },
      runSavedRecipe: async (input) => {
        let recipeId = input.id?.trim();
        if (!recipeId && input.name?.trim()) {
          const name = input.name.trim();
          const matches = (await new SavedRecipeService(env, identity.email).list()).filter((recipe) => recipe.status === "enabled" && recipe.name === name);
          if (matches.length !== 1) throw new Error(matches.length ? `ambiguous recipe name: ${name}` : `saved recipe not found: ${name}`);
          recipeId = matches[0].id;
        }
        if (!recipeId) throw new Error("recipe.run requires id or exact name");
        const result = await host.runSavedRecipe({
          recipeId,
          input: input.input ?? {},
          callerCapabilities: input.callerCapabilities,
          workCodeExecutionState: input.workCodeExecutionState,
        });
        const resultWithRecipe = result as { recipe?: { name?: string }; codemodeExecutionId?: string };
        host.onRecipeUsed?.({
          recipeId,
          name: resultWithRecipe?.recipe?.name ?? input.name ?? null,
          codemodeExecutionId: resultWithRecipe?.codemodeExecutionId ?? null,
        });
        return result;
      },
      broadcast: host.broadcast,
      callPage: host.callPage,
      identity,
      sessionId,
      bridgeBaseUrl: env.BRIDGE_BASE_URL,
      bridgeJwtSecret: env.BRIDGE_JWT_SECRET,
      env,
      workerOrigin: resolveBridgeOrigin(env.BRIDGE_BASE_URL) ?? "",
  };
}
