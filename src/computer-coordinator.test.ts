import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("the coordinator MCP reaches computers through the same owner-scoped tools", () => {
  const mcp = readFileSync(new URL("./routes/mcp.ts", import.meta.url), "utf8");
  const coordinator = readFileSync(new URL("./computer-coordinator.ts", import.meta.url), "utf8");
  for (const name of ["computer_create", "computer_exec", "computer_input", "computer_screenshot", "computer_wait"]) assert.ok(mcp.includes(`"${name}"`), name);
  assert.ok(mcp.includes("isComputerMethod(method)) return runComputerMethod(c.env, c.get(\"identity\")"));
  assert.ok(coordinator.includes("COMPUTER_EXEC_TOOL"));
});
