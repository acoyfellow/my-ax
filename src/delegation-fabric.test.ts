import assert from "node:assert/strict";
import test from "node:test";
import { pickFabricBackend, runFabric, type FabricResult, type FabricTask } from "./delegation-fabric";

const tasks: FabricTask[] = [
  { id: "a", backend: "inproc" },
  { id: "b", backend: "terrarium" },
];

function runner(script: Record<string, FabricResult>) {
  return async (task: FabricTask) => script[task.id];
}

test("backend picker refuses cmux when not dispatchable", () => {
  assert.equal(pickFabricBackend({ prefer: "cmux_pi", cmuxDispatchable: false }), "inproc");
  assert.equal(pickFabricBackend({ prefer: "cmux_pi", cmuxDispatchable: true }), "cmux_pi");
  assert.equal(pickFabricBackend({ prefer: "terrarium", terrariumReady: true }), "terrarium");
});

test("one/map/race/quorum strategies", async () => {
  const ok = { a: { id: "a", backend: "inproc" as const, ok: true, result: 1 }, b: { id: "b", backend: "terrarium" as const, ok: true, result: 2 } };
  assert.equal((await runFabric("one", tasks, runner(ok)))[0].id, "a");
  assert.deepEqual((await runFabric("map", tasks, runner(ok))).map((row) => row.id), ["a", "b"]);
  const raced = await runFabric("race", tasks, runner(ok));
  assert.equal(raced.length, 1);
  assert.ok(["a", "b"].includes(raced[0].id));
  const quorum = await runFabric("quorum", tasks, runner(ok), 2);
  assert.equal(quorum.length, 2);
});
