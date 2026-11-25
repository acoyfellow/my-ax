import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { formatKilledByOwner, processGroupWrappedCommand, runKillableWorkspaceShell, type KillableShellWorkspace } from "./killable-shell";
import { invokeMachineTool } from "./rpc/machine-host-client";

test("processGroupWrappedCommand wraps with setsid and bounded timeout", () => {
  const wrapped = processGroupWrappedCommand("sleep 30", 5_000);
  assert.match(wrapped.command, /setsid/);
  assert.match(wrapped.command, /timeout -k 2 5 bash -c/);
  assert.equal(wrapped.sandboxTimeoutMs, 10_000);
});

test("runKillableWorkspaceShell terminates process group on AbortSignal and returns Killed by owner with partial stdout", async () => {
  const signalsSent: string[] = [];
  const killCommands: string[] = [];
  const controller = new AbortController();
  const ws: KillableShellWorkspace = {
    async spawn() {
      return { id: "proc-1", pid: 4242, status: "running" };
    },
    async processInfo() {
      return { id: "proc-1", pid: 4242, status: "running" };
    },
    async processOutput() {
      return { stdout: "step 1 done\n", stderr: "" };
    },
    async stopProcess(_id, sig) {
      signalsSent.push(sig);
      return true;
    },
    async shell(cmd) {
      killCommands.push(cmd);
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };
  setTimeout(() => controller.abort(), 30);
  const result = await runKillableWorkspaceShell(ws, "sleep 30", { timeoutMs: 10_000, signal: controller.signal, pollMs: 15 });
  assert.equal(result.killedByOwner, true);
  assert.equal(result.exitCode, 137);
  assert.ok(signalsSent.includes("SIGTERM"));
  assert.ok(signalsSent.includes("SIGKILL"));
  assert.ok(killCommands.some((cmd) => cmd.includes("-4242")));
  assert.match(result.killMessage ?? "", /Killed by owner/);
  assert.match(result.killMessage ?? "", /Partial stdout: step 1 done/);
  assert.match(result.killMessage ?? "", /Do not automatically retry/);
});

test("runKillableWorkspaceShell returns stdout, stderr, and exitCode on normal completion", async () => {
  let polls = 0;
  const ws: KillableShellWorkspace = {
    async spawn() { return { id: "proc-2", pid: 100, status: "running" }; },
    async processInfo() { polls++; return { id: "proc-2", pid: 100, status: polls > 1 ? "completed" : "running", exitCode: 0 }; },
    async processOutput() { return { stdout: "ok\n", stderr: "" }; },
    async stopProcess() { return false; },
    async shell() { return { stdout: "", stderr: "", exitCode: 0 }; },
  };
  const controller = new AbortController();
  const result = await runKillableWorkspaceShell(ws, "echo ok", { timeoutMs: 10_000, signal: controller.signal, pollMs: 5 });
  assert.equal(result.killedByOwner, undefined);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "ok\n");
});

test("invokeMachineTool posts /cancel to MachineHost when AbortSignal fires", async () => {
  const cancelledOpIds: string[] = [];
  let releaseInvoke!: (res: Response) => void;
  const ns = {
    idFromName: (name: string) => name as unknown as DurableObjectId,
    get: () => ({
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/cancel")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as { opId?: string };
          if (body.opId) cancelledOpIds.push(body.opId);
          releaseInvoke(Response.json({ ok: false, error: "Killed by owner" }));
          return Response.json({ ok: true, cancelled: true });
        }
        return new Promise<Response>((resolve) => { releaseInvoke = resolve; });
      },
    }),
  };
  const controller = new AbortController();
  const pending = invokeMachineTool(ns, "owner@example.com", "shell", { command: "sleep 30" }, 30_000, "op-kill-1", "work", controller.signal);
  setTimeout(() => controller.abort(), 15);
  const result = await pending;
  assert.deepEqual(cancelledOpIds, ["op-kill-1"]);
  assert.equal((result as { ok: boolean }).ok, false);
  assert.match((result as { error: string }).error, /Killed by owner/);
});

test("legacy-tools is replaced by shared-tools without any Vercel AI SDK dependency", () => {
  const shared = readFileSync(new URL("./pi-engine/shared-tools.ts", import.meta.url), "utf8");
  const agent = readFileSync(new URL("./pi-engine/pi-chat-agent.ts", import.meta.url), "utf8");
  assert.doesNotMatch(shared, /from "ai"/);
  assert.doesNotMatch(agent, /from "ai"/);
  assert.doesNotMatch(agent, /legacy-tools/);
  assert.match(formatKilledByOwner({ tool: "exec", elapsedMs: 1500, terminated: true }), /Killed by owner after 1\.5s/);
});
