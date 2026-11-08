import assert from "node:assert/strict";
import test from "node:test";
import { invokeMachineTool, readMachineStatus } from "./machine-host-client";

const quiet = () => { const log = console.log; console.log = () => undefined; return () => { console.log = log; }; };

function namespace(fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const names: string[] = [];
  return {
    names,
    ns: {
      idFromName: (name: string) => { names.push(name); return name as unknown as DurableObjectId; },
      get: () => ({ fetch }),
    },
  };
}

test("a stuck MachineHost status read returns disconnected after the timeout instead of hanging", async () => {
  const restore = quiet();
  try {
    const { ns } = namespace(() => new Promise<Response>(() => undefined));
    const started = Date.now();
    const status = await readMachineStatus(ns, "Owner@Example.com", 20);
    assert.deepEqual(status, { connected: false, tools: [] });
    assert.ok(Date.now() - started < 1_000);
  } finally {
    restore();
  }
});

test("a healthy status read returns the host's answer for the lowercased owner", async () => {
  const restore = quiet();
  try {
    const { ns, names } = namespace(async () => Response.json({ connected: true, machineName: "mac", tools: [] }));
    assert.deepEqual(await readMachineStatus(ns, "Owner@Example.com"), { connected: true, machineName: "mac", tools: [] });
    assert.deepEqual(names, ["owner@example.com"]);
  } finally {
    restore();
  }
});

test("a stuck invoke returns an error that warns the call may still run, rather than hanging", async () => {
  const restore = quiet();
  try {
    const { ns } = namespace(() => new Promise<Response>(() => undefined));
    const result = await invokeMachineTool<{ ok: true }>(ns, "owner@example.com", "shell", { cmd: "ls" }, 20);
    assert.equal(result.ok, false);
    assert.ok("error" in result);
    assert.match(result.error, /may still finish/);
  } finally {
    restore();
  }
});

test("an invoke error is reported, not thrown", async () => {
  const restore = quiet();
  try {
    const { ns } = namespace(async () => { throw new Error("socket reset"); });
    const result = await invokeMachineTool(ns, "owner@example.com", "shell", {}, 1_000);
    assert.deepEqual(result, { ok: false, error: "My Machine call failed for shell: socket reset" });
  } finally {
    restore();
  }
});

test("every invoke carries an operation id, and a retry with the same id sends the same one", async () => {
  const restore = quiet();
  try {
    const seen: string[] = [];
    const { ns } = namespace(async (_input, init) => { seen.push(new Headers(init?.headers).get("X-Machinectl-Op-Id") ?? ""); return Response.json({ ok: true }); });
    await invokeMachineTool(ns, "owner@example.com", "shell", {}, 1_000);
    await invokeMachineTool(ns, "owner@example.com", "shell", {}, 1_000, "op-retry-0001");
    await invokeMachineTool(ns, "owner@example.com", "shell", {}, 1_000, "op-retry-0001");
    assert.ok(seen[0].length >= 8);
    assert.deepEqual(seen.slice(1), ["op-retry-0001", "op-retry-0001"]);
  } finally {
    restore();
  }
});

test("a timed-out invoke names the operation id to retry with", async () => {
  const restore = quiet();
  try {
    const { ns } = namespace(() => new Promise<Response>(() => undefined));
    const result = await invokeMachineTool<{ ok: true }>(ns, "owner@example.com", "shell", {}, 20, "op-timeout-01");
    assert.ok("error" in result);
    assert.match(String(result.error), /op-timeout-01/);
  } finally {
    restore();
  }
});
