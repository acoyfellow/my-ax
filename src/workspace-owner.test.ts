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
