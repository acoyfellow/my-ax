import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspaceLifecycle, STOPPED_UNEXPECTEDLY } from "../workspace-lifecycle";
import { initialVerification, nextVerification } from "./workspace-verification";

function harness() {
  let running = false;
  let expected = false;
  let releaseBoot!: () => void;
  const losses: string[] = [];
  const lifecycle = createWorkspaceLifecycle({
    running: () => running,
    healthy: async () => running,
    boot: () => new Promise<void>((resolve) => { releaseBoot = () => { running = true; resolve(); }; }),
    destroy: async () => { running = false; },
    expectedRunning: () => expected,
    setExpectedRunning: (value) => { expected = value; },
    announceLoss: async (reason) => { losses.push(reason); },
  });
  return { lifecycle, losses, finishBoot: () => releaseBoot(), stopContainer: () => { running = false; }, expected: () => expected };
}

test("a pause that lands during boot is not undone when the boot finishes", async () => {
  const h = harness();
  const waking = h.lifecycle.awake();
  await Promise.resolve();
  h.lifecycle.stopped();
  h.finishBoot();
  await waking;
  assert.equal(h.expected(), false);
  assert.notEqual(h.lifecycle.verification().kind, "verified");
});

test("after that pause, the next wake does not report an unexpected stop", async () => {
  const h = harness();
  const waking = h.lifecycle.awake();
  await Promise.resolve();
  h.lifecycle.stopped();
  h.finishBoot();
  await waking;
  h.stopContainer();
  const again = h.lifecycle.awake();
  await Promise.resolve();
  h.finishBoot();
  await again;
  assert.deepEqual(h.losses.filter((loss) => loss === STOPPED_UNEXPECTEDLY), []);
});

test("a stale boot success cannot mark a newer epoch verified", () => {
  const booting = nextVerification(initialVerification(), "boot_started");
  const stopped = nextVerification(booting, "stopped");
  assert.deepEqual(nextVerification(stopped, "boot_succeeded", booting.epoch), stopped);
});
