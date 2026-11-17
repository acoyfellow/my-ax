import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { frameType, MACHINES_CHANGED, ownerLiveUrl } from "./owner-live";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the owner live socket uses wss on https and ws on http", () => {
  assert.equal(ownerLiveUrl({ protocol: "https:", host: "my.ax.example" }), "wss://my.ax.example/agents/live");
  assert.equal(ownerLiveUrl({ protocol: "http:", host: "127.0.0.1:8799" }), "ws://127.0.0.1:8799/agents/live");
});

test("frames are read by type and junk is ignored", () => {
  assert.equal(frameType(JSON.stringify({ type: MACHINES_CHANGED })), MACHINES_CHANGED);
  assert.equal(frameType("not json"), null);
  assert.equal(frameType(JSON.stringify({ kind: "x" })), null);
});

test("the Machines panel listens for changes and never polls", () => {
  const panel = read("./MachinesPanel.svelte");
  assert.doesNotMatch(panel, /setInterval|setTimeout/);
  assert.match(panel, /onOwnerEvent\(MACHINES_CHANGED/);
});

test("the server announces connect, disconnect, new pending machine and approval", () => {
  const host = read("../machinectl-host.ts");
  const routes = read("../routes/machines.ts");
  assert.equal((host.match(/announceMachinesChanged|this\.announce\(\)/g) ?? []).length >= 3, true);
  assert.match(routes, /admission\.state === "pending"\) c\.executionCtx\.waitUntil\(announceMachinesChanged/);
  assert.match(routes, /approveMachine[\s\S]{0,200}announceMachinesChanged/);
  assert.match(read("../index.tsx"), /app\.get\("\/agents\/live"[\s\S]{0,300}getUserAgent\(c\.env, c\.get\("identity"\)\.email\)/);
});
