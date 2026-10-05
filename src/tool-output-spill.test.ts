import assert from "node:assert/strict";
import test from "node:test";
import { commandInput } from "./work-tools";
import { limitModelToolOutputWithSpill, TOOL_OUTPUT_SPILL_DIR } from "./tool-output-limit";

test("short output passes through untouched and writes nothing", async () => {
  const writes: string[] = [];
  const result = await limitModelToolOutputWithSpill("small", "read", async (path) => { writes.push(path); }, 1024);
  assert.equal(result, "small");
  assert.deepEqual(writes, []);
});

test("cut-off output saves the full text and says where, within the limit", async () => {
  const full = "row\n".repeat(5_000);
  const saved = new Map<string, string>();
  const result = await limitModelToolOutputWithSpill(full, "manage_jobs", async (path, content) => { saved.set(path, content); }, 4096);
  const [path, content] = [...saved.entries()][0];
  assert.equal(content, full);
  assert.ok(path.startsWith(`${TOOL_OUTPUT_SPILL_DIR}/`) && path.includes("manage_jobs"));
  assert.match(result, /INCOMPLETE RESULT/);
  assert.ok(result.includes(path));
  assert.ok(new TextEncoder().encode(result).byteLength <= 4096 + 200);
});

test("when saving fails the result still says it is incomplete", async () => {
  const result = await limitModelToolOutputWithSpill("x".repeat(10_000), "read", async () => { throw new Error("disk"); }, 2048);
  assert.match(result, /INCOMPLETE RESULT.*Saving the full output failed/s);
});

test("without a writer the result still says it is incomplete", async () => {
  const result = await limitModelToolOutputWithSpill("x".repeat(10_000), "read", undefined, 2048);
  assert.match(result, /INCOMPLETE RESULT.*not saved/s);
});

test("workspace exec accepts a plain command string as well as an object", () => {
  assert.deepEqual(commandInput("ls -la"), { command: "ls -la" });
  assert.deepEqual(commandInput({ command: "ls", cwd: "/home/user" }), { command: "ls", cwd: "/home/user" });
});
