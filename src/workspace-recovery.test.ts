import { test } from "node:test";
import assert from "node:assert/strict";

const WEDGED = "WebSocket upgrade failed: 500 Internal Server Error";

type FakeSandbox = {
  readFile: (path: string) => Promise<{ content: string }>;
  writeFile: (path: string, content: string) => Promise<void>;
  listFiles: (path: string) => Promise<{ files: Array<{ name: string; absolutePath: string; type: "file"; size: number; modifiedAt: string }> }>;
  exec: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number; success: boolean }>;
  startProcess: (cmd: string) => Promise<{ id: string }>;
};

function wedgedThenHealthy() {
  const state = { destroyed: 0, acquired: 0, ran: [] as string[] };
  const healthy: FakeSandbox = {
    readFile: async (path) => { state.ran.push(`read ${path}`); return { content: "hello" }; },
    writeFile: async (path) => { state.ran.push(`write ${path}`); },
    listFiles: async (path) => { state.ran.push(`list ${path}`); return { files: [{ name: "a.txt", absolutePath: `${path}/a.txt`, type: "file", size: 5, modifiedAt: "2026-10-25T00:00:00Z" }] }; },
    exec: async (cmd) => { state.ran.push(`exec ${cmd}`); return { stdout: "alive\n", stderr: "", exitCode: 0, success: true }; },
    startProcess: async (cmd) => { state.ran.push(`start ${cmd}`); return { id: "p1" }; },
  };
  const access = {
    acquire: async () => {
      state.acquired += 1;
      if (state.destroyed === 0) throw new Error(WEDGED);
      return healthy;
    },
    destroy: async () => { state.destroyed += 1; },
  };
  return { state, access };
}

function diesMidCommand() {
  const state = { destroyed: 0, ran: 0 };
  const dying: Pick<FakeSandbox, "startProcess" | "readFile"> = {
    startProcess: async () => { state.ran += 1; throw new Error("Connection closed: this Durable Object instance is no longer active."); },
    readFile: async () => { state.ran += 1; if (state.destroyed === 0) throw new Error(WEDGED); return { content: "after reset" }; },
  };
  return { state, access: { acquire: async () => dying, destroy: async () => { state.destroyed += 1; } } };
}

test("Pi and Think file reads recover from a wedged container with exactly one reset", async () => {
  const { useWorkspace } = await import("./workspace-access");
  const { state, access } = wedgedThenHealthy();
  const file = await useWorkspace(access, "idempotent", (sandbox) => sandbox.readFile("/home/user/a.txt"));
  assert.equal(file.content, "hello");
  assert.equal(state.destroyed, 1);
  assert.deepEqual(state.ran, ["read /home/user/a.txt"]);
});

test("file writes and listings recover from a wedged container with exactly one reset", async () => {
  const { useWorkspace } = await import("./workspace-access");
  const { state, access } = wedgedThenHealthy();
  await useWorkspace(access, "idempotent", (sandbox) => sandbox.writeFile("/home/user/b.txt", "x"));
  const listing = await useWorkspace(access, "idempotent", (sandbox) => sandbox.listFiles("/home/user"));
  assert.equal(listing.files.length, 1);
  assert.equal(state.destroyed, 1);
  assert.deepEqual(state.ran, ["write /home/user/b.txt", "list /home/user"]);
});

test("a background process start recovers when the container is wedged before it starts", async () => {
  const { useWorkspace } = await import("./workspace-access");
  const { state, access } = wedgedThenHealthy();
  const process = await useWorkspace(access, "side-effecting", (sandbox) => sandbox.startProcess("npm test"));
  assert.equal(process.id, "p1");
  assert.equal(state.destroyed, 1);
  assert.deepEqual(state.ran, ["start npm test"]);
});

test("a side-effecting command whose container dies mid-run resets once and is never re-run", async () => {
  const { useWorkspace, WorkspaceDiedMidCommandError } = await import("./workspace-access");
  const { state, access } = diesMidCommand();
  await assert.rejects(useWorkspace(access, "side-effecting", (sandbox) => sandbox.startProcess("deploy")), WorkspaceDiedMidCommandError);
  assert.equal(state.ran, 1);
  assert.equal(state.destroyed, 1);
});

test("an idempotent read whose container dies mid-call is retried once on the fresh container", async () => {
  const { useWorkspace } = await import("./workspace-access");
  const { state, access } = diesMidCommand();
  const file = await useWorkspace(access, "idempotent", (sandbox) => sandbox.readFile("/home/user/a.txt"));
  assert.equal(file.content, "after reset");
  assert.equal(state.ran, 2);
  assert.equal(state.destroyed, 1);
});

test("shell exec in jobs and the Think engine recovers from a wedged container at acquire", async () => {
  const { acquireWithOneReset } = await import("./workspace-access");
  const { workspaceShellExec } = await import("./workspace-exec");
  const { state, access } = wedgedThenHealthy();
  const result = await workspaceShellExec(async () => ({ sandbox: await acquireWithOneReset(access), recycled: false }), "echo alive", {});
  assert.equal(result.stdout, "alive\n");
  assert.equal(result.exitCode, 0);
  assert.equal(state.destroyed, 1);
  assert.deepEqual(state.ran, ["exec echo alive"]);
});

test("Pi chat exec whose container dies mid-command resets once and does not re-run the command", async () => {
  const { recoveringWorkspaceExec } = await import("./workspace-exec");
  let runs = 0;
  let destroys = 0;
  const result = await recoveringWorkspaceExec({
    acquire: async () => "sandbox",
    exec: async () => { runs += 1; throw new Error("Connection closed: this Durable Object instance is no longer active."); },
    destroy: async () => { destroys += 1; },
  });
  assert.equal(runs, 1);
  assert.equal(destroys, 1);
  assert.equal(result.exitCode, -1);
  assert.match(result.stderr, /was not re-run/);
});

test("Pi chat exec recovers from a wedged container at acquire and runs the command once", async () => {
  const { recoveringWorkspaceExec } = await import("./workspace-exec");
  const { state, access } = wedgedThenHealthy();
  const result = await recoveringWorkspaceExec({ acquire: access.acquire, exec: (sandbox) => sandbox.exec("echo alive"), destroy: access.destroy });
  assert.equal(result.stdout, "alive\n");
  assert.equal(state.destroyed, 1);
  assert.deepEqual(state.ran, ["exec echo alive"]);
});

test("an ordinary error is surfaced without resetting the container", async () => {
  const { useWorkspace } = await import("./workspace-access");
  let destroyed = 0;
  const access = { acquire: async () => ({ readFile: async () => { throw new Error("ENOENT: no such file"); } }), destroy: async () => { destroyed += 1; } };
  await assert.rejects(useWorkspace(access, "idempotent", (sandbox) => sandbox.readFile()), /ENOENT/);
  assert.equal(destroyed, 0);
});

test("the Think workspace adapter routes every sandbox call through the recovering access", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./think-workspace.ts", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /this\.sandbox\(\)/);
  assert.doesNotMatch(source, /getUserWorkspace\(/);
  assert.match(source, /useWorkspace\(userWorkspaceAccess/);
});

test("the shared tool context reaches the sandbox only through the recovering access", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./tool-context.ts", import.meta.url), "utf8"));
  const direct = source.match(/const \{ sandbox \} = await getUserWorkspace\(/g) ?? [];
  assert.equal(direct.length, 0);
});

test("Pi chat file tools go through the recovering access", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./pi-engine/pi-chat-agent.ts", import.meta.url), "utf8"));
  const body = source.slice(source.indexOf("private async chatWorkspace()"), source.indexOf("private toolEnv()"));
  for (const tool of ["readFile", "writeFile", "listFiles"]) assert.match(body, new RegExp(`${tool}: async[\\s\\S]*?useWorkspace\\(access`));
});
