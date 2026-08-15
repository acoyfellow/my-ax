import assert from "node:assert/strict";
import test from "node:test";
import { assertSeedablePath } from "./workspace-path";

test("durable write paths must stay under /home/user", () => {
  assert.doesNotThrow(() => assertSeedablePath("/home/user/bugs/README.md"));
  assert.doesNotThrow(() => assertSeedablePath("/home/user"));
  assert.throws(() => assertSeedablePath("/bugs/voice.md"), /not durable/);
  assert.throws(() => assertSeedablePath("/relay/server.mjs"), /not durable/);
  assert.throws(() => assertSeedablePath("/home/user/../etc/passwd"), /traversal/);
});
