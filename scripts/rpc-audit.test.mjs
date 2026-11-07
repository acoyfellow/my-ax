import assert from "node:assert/strict";
import test from "node:test";
import { audit, machinectlCancelsOnTimeout, machinectlCarriesOpId } from "./rpc-audit.mjs";

const run = (text, allow = []) => audit(["/repo/src/x.ts"], () => text, allow).map((violation) => violation.rule);

test("R1 flags AbortSignal.timeout", () => {
  assert.deepEqual(run("const s = AbortSignal.timeout(1000);"), ["R1"]);
});

test("R2 flags an unwrapped stub call and accepts a wrapped or allowlisted one", () => {
  assert.deepEqual(run("const stub = await getSessionAgent(env, a, b);\nawait stub.go();"), ["R2"]);
  assert.deepEqual(run("const stub = await getSessionAgent(env, a, b);\nconst r = await withTimeout({ promise: stub.go(), timeoutMs: 1, op: \"x\" });"), []);
  const allow = [{ file: "../repo/src/x.ts", match: "getSessionAgent(env, a, b)", reason: "stub lookup only, call wrapped by caller" }];
  assert.ok(Array.isArray(audit(["/repo/src/x.ts"], () => "const stub = await getSessionAgent(env, a, b);", allow)));
});

test("R2 ignores function declarations and imports", () => {
  assert.deepEqual(run("export async function getSessionAgent(env, a, b) {"), []);
  assert.deepEqual(run("import { getAgentByName } from \"agents\";"), []);
});

test("R3 flags retryOnTimeout without an opId nearby", () => {
  assert.deepEqual(run("withRetry({ start, op: \"x\", timeoutMs: 1, retryOnTimeout: true });"), ["R3"]);
  assert.deepEqual(run("const opId = id();\nwithRetry({ start: () => s.go({ opId }), op: \"x\", timeoutMs: 1, retryOnTimeout: true });"), []);
});

test("R4 flags a setTimeout race that never clears", () => {
  assert.deepEqual(run("await Promise.race([p, new Promise((r) => setTimeout(r, 5))]);"), ["R4"]);
  assert.deepEqual(run("const t = setTimeout(r, 5);\nawait Promise.race([p]);\nclearTimeout(t);"), []);
});

test("a stale allowlist entry is itself a violation", () => {
  const allow = [{ file: "src/x.ts", match: "nothing here", reason: "a reason that is long enough" }];
  assert.deepEqual(audit(["/repo/src/x.ts"], () => "const a = 1;", allow).map((violation) => violation.rule), ["ALLOW"]);
});

test("R5 needs an opId on machinectl call frames", () => {
  assert.equal(machinectlCarriesOpId('socket.send(JSON.stringify({ type: "call", id, tool, args }));'), false);
  assert.equal(machinectlCarriesOpId('socket.send(JSON.stringify({ type: "call", id, opId, tool, args }));'), true);
});

test("R5 needs a timed-out machinectl call to send cancel and warn that it may still finish", () => {
  const silent = 'const timer = setTimeout(() => { this.pending.delete(id); resolve({ ok: false, error: "timed out" }); }, CALL_TIMEOUT_MS);';
  assert.equal(machinectlCancelsOnTimeout(silent), false);
  const cancelling = 'socket.send(JSON.stringify({ type: "cancel", id })); "It may still finish"\nconst timer = setTimeout(() => { this.pending.delete(id); cancelLaptopCall(socket, id); resolve(x); }, CALL_TIMEOUT_MS);';
  assert.equal(machinectlCancelsOnTimeout(cancelling), true);
});
