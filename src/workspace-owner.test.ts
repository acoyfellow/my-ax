import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

type FakeContainer = { running: boolean; boots: number; destroys: number; losses: string[]; expected: boolean; healthy: boolean };

async function lifecycleOver(container: FakeContainer, bootDelayMs = 0) {
  const { createWorkspaceLifecycle } = await import("./workspace-lifecycle");
  return createWorkspaceLifecycle({
    running: () => container.running,
    healthy: async () => container.healthy,
    boot: async () => {
      container.boots += 1;
      if (bootDelayMs) await new Promise((resolve) => setTimeout(resolve, bootDelayMs));
      container.running = true;
      container.healthy = true;
    },
    destroy: async () => {
      container.destroys += 1;
      container.running = false;
    },
    expectedRunning: () => container.expected,
    setExpectedRunning: (expected) => { container.expected = expected; },
    announceLoss: async (reason) => { container.losses.push(reason); },
  });
}

function stoppedContainer(): FakeContainer {
  return { running: false, boots: 0, destroys: 0, losses: [], expected: false, healthy: false };
}

test("concurrent callers share one boot of a stopped container", async () => {
  const container = stoppedContainer();
  const lifecycle = await lifecycleOver(container, 20);
  const results = await Promise.all([1, 2, 3, 4, 5].map((n) => lifecycle.use("idempotent", async () => n)));
  assert.deepEqual(results, [1, 2, 3, 4, 5]);
  assert.equal(container.boots, 1);
});

test("a running container is not booted again", async () => {
  const container = stoppedContainer();
  const lifecycle = await lifecycleOver(container);
  await lifecycle.awake();
  await lifecycle.awake();
  await lifecycle.use("idempotent", async () => "ok");
  assert.equal(container.boots, 1);
});

test("liveness comes from the platform running flag, not from error text", async () => {
  const container = stoppedContainer();
  const lifecycle = await lifecycleOver(container);
  await lifecycle.awake();
  container.running = false;
  const value = await lifecycle.use("idempotent", async () => "after reboot");
  assert.equal(value, "after reboot");
  assert.equal(container.boots, 2);
});

test("an ordinary command error on a healthy container is surfaced without touching the container", async () => {
  const container = stoppedContainer();
  const lifecycle = await lifecycleOver(container);
  await assert.rejects(lifecycle.use("idempotent", async () => { throw new Error("WebSocket upgrade failed: 500"); }), /WebSocket upgrade failed/);
  assert.equal(container.destroys, 0);
  assert.equal(container.boots, 1);
});

test("a side-effecting command whose container dies mid-run is never re-run", async () => {
  const { WorkspaceLost } = await import("./workspace-lifecycle");
  const container = stoppedContainer();
  const lifecycle = await lifecycleOver(container);
  let runs = 0;
  await assert.rejects(lifecycle.use("side-effecting", async () => {
    runs += 1;
    container.running = false;
    throw new Error("connection lost");
  }), WorkspaceLost);
  assert.equal(runs, 1);
  assert.equal(container.boots, 2);
});

test("an idempotent call whose container dies mid-call runs once more on the new container", async () => {
  const container = stoppedContainer();
  const lifecycle = await lifecycleOver(container);
  let runs = 0;
  const value = await lifecycle.use("idempotent", async () => {
    runs += 1;
    if (runs === 1) { container.running = false; throw new Error("connection lost"); }
    return "read";
  });
  assert.equal(value, "read");
  assert.equal(runs, 2);
});

test("a container that hangs while still marked running is replaced once", async () => {
  const container = stoppedContainer();
  const lifecycle = await lifecycleOver(container);
  await lifecycle.awake();
  container.healthy = false;
  let runs = 0;
  const value = await lifecycle.use("idempotent", async () => {
    runs += 1;
    if (runs === 1) throw new Error("timed out");
    return "ok";
  });
  assert.equal(value, "ok");
  assert.equal(container.destroys, 1);
  assert.equal(container.boots, 2);
});

test("an unexpected stop is announced, and a deliberate stop is not", async () => {
  const { STOPPED_UNEXPECTEDLY } = await import("./workspace-lifecycle");
  const crashed = stoppedContainer();
  const lifecycle = await lifecycleOver(crashed);
  await lifecycle.awake();
  crashed.running = false;
  await lifecycle.awake();
  assert.deepEqual(crashed.losses, [STOPPED_UNEXPECTEDLY]);

  const paused = stoppedContainer();
  const pausedLifecycle = await lifecycleOver(paused);
  await pausedLifecycle.awake();
  pausedLifecycle.stopped();
  paused.running = false;
  await pausedLifecycle.awake();
  assert.deepEqual(paused.losses, []);
});

test("the workspace object is the only place that opens sandbox stubs or recovers containers", async () => {
  const files = ["tool-context.ts", "think-workspace.ts", "pi-engine/pi-chat-agent.ts", "routes/terminal.ts", "routes/mcp.ts", "routes/machinectl.ts", "conversation-log.ts", "index.tsx", "workspace.ts", "workspace-exec.ts", "named-computer.ts"];
  for (const file of files) {
    const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /getSandbox\(|getUserWorkspace\(|DEAD_SANDBOX_PATTERNS|useWorkspace\(|isDeadSandboxError/, file);
  }
});

test("every workspace caller goes through workspaceFor", async () => {
  for (const file of ["tool-context.ts", "think-workspace.ts", "pi-engine/pi-chat-agent.ts", "routes/terminal.ts", "routes/mcp.ts", "routes/machinectl.ts", "conversation-log.ts"]) {
    const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
    assert.match(source, /workspaceFor\(/, file);
  }
});

test("the deployed Sandbox class is the workspace object", async () => {
  const source = await readFile(new URL("./index.tsx", import.meta.url), "utf8");
  assert.match(source, /export \{ WorkspaceObject as Sandbox \} from "\.\/workspace-object"/);
});

test("saves at the same workspace run one after another, never at once", async () => {
  const { createSaveQueue } = await import("./workspace-save-policy");
  const queue = createSaveQueue();
  const order: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const work = (name: string, ms: number) => async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, ms));
    order.push(name);
    inFlight -= 1;
    return name;
  };
  await Promise.all([queue.save("pause", work("pause", 20)), queue.save("compaction", work("compaction", 5)), queue.save("fork", work("fork", 1))]);
  assert.equal(maxInFlight, 1);
  assert.deepEqual(order, ["pause", "compaction", "fork"]);
});

test("a failed save does not block the next one", async () => {
  const { createSaveQueue } = await import("./workspace-save-policy");
  const queue = createSaveQueue();
  await assert.rejects(queue.save("pause", async () => { throw new Error("disk full"); }), /disk full/);
  assert.equal(await queue.save("fork", async () => "saved"), "saved");
});

test("a finished compaction triggers a save, and a failed one does not", async () => {
  const { compactionFinished } = await import("./workspace-save-policy");
  assert.equal(compactionFinished([{ type: "turn_end" }, { type: "compaction_end" }]), true);
  assert.equal(compactionFinished([{ type: "compaction_end", error: "orphaned" }]), false);
  assert.equal(compactionFinished([{ type: "turn_end" }]), false);
});

test("workspaces save only at pause, compaction and fork, not after every turn", async () => {
  const pi = await readFile(new URL("./pi-engine/pi-chat-agent.ts", import.meta.url), "utf8");
  const think = await readFile(new URL("./agent.ts", import.meta.url), "utf8");
  const object = await readFile(new URL("./workspace-object.ts", import.meta.url), "utf8");
  for (const source of [pi, think]) {
    assert.doesNotMatch(source, /scheduleTurnSnapshot|scheduleBackupRetry|"turn", \{ scope, respectCooldown|schedule\(0, "snapshotWorkspaceAfterTurn"\)/);
  }
  assert.match(pi, /compactionFinished\(/);
  assert.match(think, /compactThenSave\(/);
  assert.match(object, /saves\.save\("pause"/);
});

type SessionRow = { id: string; name: string; engine: string; status: string; updated_at: string; owner_email: string };

function fakeDb(rows: SessionRow[]) {
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          const [id, owner] = args as [string, string];
          return rows.find((row) => row.id === id && row.owner_email === owner && row.status !== "archived") ?? null;
        },
        all: async () => {
          const [owner, limit] = args as [string, number];
          return { results: rows.filter((row) => row.owner_email === owner && row.status !== "archived").slice(0, limit) };
        },
        run: async () => ({ sql }),
      }),
    }),
  };
}

async function directoryFixture() {
  const { createWorkspaceDirectory } = await import("./workspace-directory");
  const rows: SessionRow[] = [
    { id: "chat-a", name: "A", engine: "pi", status: "active", updated_at: "2026-10-25", owner_email: "me@x.test" },
    { id: "chat-b", name: "B", engine: "pi", status: "active", updated_at: "2026-10-25", owner_email: "me@x.test" },
    { id: "chat-stranger", name: "S", engine: "pi", status: "active", updated_at: "2026-10-25", owner_email: "them@x.test" },
  ];
  const disks = new Map<string, Map<string, string>>();
  const submitted: Array<{ chatId: string; text: string }> = [];
  const forked: string[] = [];
  const directory = createWorkspaceDirectory({ DB: fakeDb(rows) } as never, "Me@x.test", {
    workspace: async (_env, _identity, scope) => {
      const key = scope.kind === "owner" ? "owner" : scope.chatId;
      if (!disks.has(key)) disks.set(key, new Map());
      const disk = disks.get(key)!;
      return { read: async (path: string) => disk.get(path) ?? "", write: async (path: string, content: string) => { disk.set(path, content); } };
    },
    openChat: async (_env, _owner, chatId) => ({ submit: async (text: string) => { submitted.push({ chatId, text }); return { ok: true }; } }),
    forkChat: async (_env, _owner, sourceId) => { forked.push(sourceId); return { sessionId: `${sourceId}-fork`, name: "fork", messageCount: 3 }; },
  });
  return { directory, disks, submitted, forked };
}

test("the directory lists the owner's workspaces and none of anyone else's", async () => {
  const { directory } = await directoryFixture();
  const ids = (await directory.list()).map((entry) => entry.id);
  assert.deepEqual(ids, ["owner", "chat-a", "chat-b"]);
});

test("one workspace messages a sibling, which receives it as a new turn naming the sender", async () => {
  const { directory, submitted } = await directoryFixture();
  await directory.message("chat-a", "chat-b", "please run the tests");
  assert.deepEqual(submitted, [{ chatId: "chat-b", text: "[message from workspace chat-a]\nplease run the tests" }]);
});

test("a file written into a sibling workspace lands only in that sibling, under /home/user", async () => {
  const { directory, disks } = await directoryFixture();
  await directory.writeFile("chat-b", "shared/plan.md", "step 1");
  assert.equal(await directory.readFile("chat-b", "shared/plan.md"), "step 1");
  assert.equal(disks.get("chat-b")?.get("/home/user/shared/plan.md"), "step 1");
  assert.equal(disks.get("chat-a"), undefined);
});

test("sibling file paths cannot escape /home/user", async () => {
  const { directory } = await directoryFixture();
  await assert.rejects(directory.writeFile("chat-b", "/etc/passwd", "x"), /inside \/home\/user/);
  await assert.rejects(directory.readFile("chat-b", "/home/user/../../etc/passwd"), /traversal|inside/);
});

test("another owner's workspace cannot be messaged, read, written or forked", async () => {
  const { WorkspaceNotOwned } = await import("./workspace-directory");
  const { directory, submitted, disks, forked } = await directoryFixture();
  await assert.rejects(directory.message("chat-a", "chat-stranger", "hi"), WorkspaceNotOwned);
  await assert.rejects(directory.readFile("chat-stranger", "a.txt"), WorkspaceNotOwned);
  await assert.rejects(directory.writeFile("chat-stranger", "a.txt", "x"), WorkspaceNotOwned);
  await assert.rejects(directory.fork("chat-stranger", "1"), WorkspaceNotOwned);
  assert.equal(submitted.length, 0);
  assert.equal(disks.size, 0);
  assert.equal(forked.length, 0);
});

test("a sibling can be forked through the directory", async () => {
  const { directory, forked } = await directoryFixture();
  const result = await directory.fork("chat-a", "5");
  assert.equal(result.sessionId, "chat-a-fork");
  assert.deepEqual(forked, ["chat-a"]);
});

test("Pi chats get the sibling workspace tools and the API exposes the directory", async () => {
  const pi = await readFile(new URL("./pi-engine/pi-chat-agent.ts", import.meta.url), "utf8");
  const index = await readFile(new URL("./index.tsx", import.meta.url), "utf8");
  assert.match(pi, /siblingWorkspaceExtension\(/);
  assert.match(index, /registerWorkspaceDirectoryRoutes\(app\)/);
});
