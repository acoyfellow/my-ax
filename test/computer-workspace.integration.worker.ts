import { ComputerWorkspace, getComputerHealth, withOwnerComputerWorkspace } from "../src/computer-workspace";
import { readComputerFileFromWorkspace } from "../src/computer-filesystem";
import { computerWorkspaceName } from "../src/computer-owner";

export { ComputerWorkspace };

type IntegrationEnv = {
  COMPUTER: DurableObjectNamespace<ComputerWorkspace>;
};

type WriteRequest = {
  owner: string;
  path: unknown;
  content: unknown;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseWriteRequest(value: unknown): WriteRequest {
  if (typeof value !== "object" || value === null) throw new Error("Expected a JSON object.");
  const input = value as Partial<WriteRequest>;
  if (typeof input.owner !== "string") throw new Error("Expected an owner string.");
  return { owner: input.owner, path: input.path, content: input.content };
}

function ownerFrom(url: URL): string {
  const owner = url.searchParams.get("owner");
  if (!owner) throw new Error("Expected an owner query parameter.");
  return owner;
}

function pathFrom(url: URL): string {
  const path = url.searchParams.get("path");
  if (!path) throw new Error("Expected a path query parameter.");
  return path;
}

export default {
  async fetch(request, env: IntegrationEnv): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/ready") return Response.json({ ok: true });
      if (request.method === "POST" && url.pathname === "/write") {
        const input = parseWriteRequest(await request.json());
        const identity = { email: input.owner };
        const id = env.COMPUTER.idFromName(computerWorkspaceName(identity));
        const result = await env.COMPUTER.get(id).write({ path: input.path, content: input.content });
        return Response.json(result);
      }
      if (request.method === "GET" && url.pathname === "/read") {
        const identity = { email: ownerFrom(url) };
        const result = await withOwnerComputerWorkspace(env, identity, (workspace) =>
          readComputerFileFromWorkspace(workspace, { path: pathFrom(url) }),
        );
        return Response.json(result);
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json(await getComputerHealth(env, { email: ownerFrom(url) }));
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      return Response.json({ error: errorMessage(error) }, { status: 400 });
    }
  },
} satisfies ExportedHandler<IntegrationEnv>;
