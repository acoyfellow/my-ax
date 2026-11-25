import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { formatKilledByOwner, pgidKillCommand, processGroupWrappedCommand, runKillableWorkspaceShell, type KillableShellWorkspace } from "./killable-shell";
import { invokeMachineTool } from "./rpc/machine-host-client";

test("processGroupWrappedCommand writes a PGID file inside GNU timeout without setsid", () => {
  const wrapped = processGroupWrappedCommand("sleep 30", 5_000, "job1");
  assert.match(wrapped.command, /timeout -k 2 5 bash -c/);
  assert.match(wrapped.command, /\/tmp\/myax-pgid-job1/);
  assert.doesNotMatch(wrapped.command, /\bsetsid\b/);
  assert.equal(wrapped.sandboxTimeoutMs, 10_000);
  const killCmd = pgidKillCommand(wrapped.pgidFile);
  assert.match(killCmd, /kill -TERM -"\$pg"/);
  assert.match(killCmd, /kill -KILL -"\$pg"/);
  assert.match(killCmd, /"\$pg" != "\$mypg"/);
});

test("runKillableWorkspaceShell kills process group via PGID file on AbortSignal and returns Killed by owner with partial stdout", async () => {
  const calls: string[] = [];
  let releaseMain!: (res: { stdout: string; stderr: string; exitCode: number }) => void;
  const controller = new AbortController();
  const ws: KillableShellWorkspace = {
    async shell(cmd) {
      calls.push(cmd);
      if (cmd.includes("kill -KILL")) {
        releaseMain({ stdout: "step 1 done\n", stderr: "", exitCode: 137 });
        return { stdout: "KILLED:4242\n", stderr: "", exitCode: 0 };
      }
      return new Promise((resolve) => { releaseMain = resolve; });
    },
  };
  setTimeout(() => controller.abort(), 20);
  const result = await runKillableWorkspaceShell(ws, "sleep 30", { timeoutMs: 10_000, signal: controller.signal, tag: "t1" });
  assert.equal(result.killedByOwner, true);
  assert.equal(result.exitCode, 137);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /\/tmp\/myax-pgid-t1/);
  assert.match(calls[1], /kill -TERM/);
  assert.match(calls[1], /kill -KILL/);
  assert.match(result.killMessage ?? "", /Killed by owner/);
  assert.match(result.killMessage ?? "", /Underlying process terminated \(SIGKILL\)/);
  assert.match(result.killMessage ?? "", /Partial stdout: step 1 done/);
  assert.match(result.killMessage ?? "", /Do not automatically retry/);
});

test("runKillableWorkspaceShell returns stdout, stderr, and exitCode directly on normal completion", async () => {
  const ws: KillableShellWorkspace = {
    async shell() {
      return { stdout: "ok\n", stderr: "", exitCode: 0 };
    },
  };
  const controller = new AbortController();
  const result = await runKillableWorkspaceShell(ws, "echo ok", { timeoutMs: 10_000, signal: controller.signal, tag: "t2" });
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
