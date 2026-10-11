import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { sandboxOnlyForTurn } from "./recurring-job-run";

const source = readFileSync(new URL("./work-tools.ts", import.meta.url), "utf8");
const agent = readFileSync(new URL("./agent.ts", import.meta.url), "utf8");

test("work_code sandboxOnly turns withhold machine and keep factory page verbs", () => {
  assert.match(source, /export const SANDBOX_ONLY_WORK_CAPABILITIES = WORKSPACE_METHODS\.map/);
  assert.match(source, /sandboxOnly \? \{ catalog: \[\]/);
  assert.match(source, /FACTORY_PAGE_METHODS/);
  assert.match(source, /sandboxOnly \? "globalThis\.machine=undefined;"/);
  assert.doesNotMatch(source, /List or filter codemode tools across My AX Workspace, My Machine/);
});

test("open_issue_session is a Worker tool for factory fan-out", () => {
  const tools = readFileSync(new URL("./tools.ts", import.meta.url), "utf8");
  assert.match(tools, /name: "open_issue_session"/);
  assert.match(tools, /issueSessionTitle/);
  assert.match(tools, /if \(sandboxOnly && definition\.name === "cmux_observe"\) continue/);
});

test("sandboxOnly is decided per turn, never saved to session config", () => {
  // Regression: a saved sandboxOnly flag outlived the job turn and locked every
  // later owner turn out of My Machine, page and delegate tools.
  assert.doesNotMatch(agent, /configure<MyAgentConfig>\(\{[^}]*sandboxOnly/);
  assert.doesNotMatch(agent, /getConfig<MyAgentConfig>\(\)\?\.sandboxOnly/);
  assert.match(agent, /const sandboxOnly = agent\.turnIsSandboxOnly\(\);/);
  assert.match(agent, /const sandboxOnly = this\.currentTurnSandboxOnly;/);
  assert.match(agent, /callPage: \(verb, args, opts\) => this\.callPage/);
});

test("job turns are sandbox-only; the next owner turn is not", () => {
  const job = { role: "user", id: "job:91c22636-4f72-49cd-bee0-46d46dda8dd8:1760044000000" };
  const injectedJob = { role: "user", id: "job:91c22636-4f72-49cd-bee0-46d46dda8dd8:1760044000000:3" };
  const reply = { role: "assistant", id: "a1" };
  assert.equal(sandboxOnlyForTurn([job]), true);
  assert.equal(sandboxOnlyForTurn([injectedJob]), true);
  assert.equal(sandboxOnlyForTurn([job, reply]), true, "assistant messages don't end job mode");
  assert.equal(sandboxOnlyForTurn([job, reply, { role: "user", id: "client-7f3a" }]), false, "owner chat after a job run");
  assert.equal(sandboxOnlyForTurn([job, reply, { role: "user", id: "decision:run-decision-1" }]), false, "decision answer after a job run");
  assert.equal(sandboxOnlyForTurn([{ role: "user", id: "job:anything" }]), true, "fails closed on any job: id");
  assert.equal(sandboxOnlyForTurn([{ role: "user" }]), false);
  assert.equal(sandboxOnlyForTurn([]), false);
});
