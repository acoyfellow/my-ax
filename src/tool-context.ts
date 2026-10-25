import type { AccessIdentity } from "./auth";
import type { Env, ToolContext } from "./types";
import type { WorkspaceScope } from "./workspace-policy";
import type { WorkCodeExecutionState } from "./computer-work-budget";
import { observeSessionTurns } from "./observe";
import { recentObserveEvents } from "./observe-events";
import { buildConversationSearchQuery } from "./conversation-search";
import { workspaceShellExec } from "./workspace-exec";
import { SandboxThinkWorkspace } from "./think-workspace";
import { workspaceFor, WORKSPACE_HOME } from "./workspace";
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
  const workspace = () => workspaceFor(env, identity, scope);
  const toolEnv = (extra?: Record<string, string>) => ({ ACCESS_EMAIL: identity.email, XDG_CONFIG_HOME: "/home/user/.config", ...extra });
  return {
      workingDirectory,
      sandboxOnly,
      notifyOwner: (input) => notifyOwner(env, identity.email, { ...input, sessionId }),
      shellExec: (cmd, opts) => workspaceShellExec(workspace, cmd, { cwd: opts?.cwd ?? workingDirectory, timeout: opts?.timeout ?? 30_000, env: toolEnv(opts?.env) }),
      processStart: async (cmd, opts) => (await workspace()).spawn(cmd, { cwd: opts?.cwd ?? workingDirectory, timeout: opts?.timeout, processId: opts?.processId, autoCleanup: false, env: toolEnv(opts?.env) }),
      processStatus: async (id) => (await workspace()).processInfo(id),
      processLogs: async (id) => (await workspace()).processOutput(id),
      processCancel: async (id, signal) => (await workspace()).stopProcess(id, signal ?? "SIGTERM"),
      runCode: async (code, options) => (await workspace()).code(code, { language: options?.language ?? "python", cwd: workingDirectory, run: { timeout: options?.timeout, envVars: toolEnv() } }),
      tunnelGet: async (port) => (await workspace()).tunnel("get", [port]) as never,
      tunnelList: async () => (await workspace()).tunnel("list", []) as never,
      tunnelDestroy: async (port) => { await (await workspace()).tunnel("destroy", [port]); },
      readFile: async (path, options) => {
        const maxBytes = options?.maxBytes;
        if (maxBytes === undefined) return new SandboxThinkWorkspace(env, () => identity, scope).readFile(path);
        const ws = await workspace();
        return readBoundedWorkspaceFile({ exec: (command, opts) => ws.shell(command, opts) }, path, maxBytes);
      },
      writeFile: async (path, content) => new SandboxThinkWorkspace(env, () => identity, scope).writeFile(path, content),
      listFiles: async (path, opts) => {
        const files = await (await workspace()).list(path, opts);
        return files.map((file) => ({ path: file.absolutePath, name: file.name, type: file.type, size: file.size }));
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
