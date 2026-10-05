import { test } from "node:test";
import assert from "node:assert/strict";
import { postSessionWithRetry, sessionCreateErrorMessage } from "./session-create";

const okResponse = () => new Response(JSON.stringify({ result: { sessionId: "s1", name: "n" } }), { status: 200 });
const noWait = async () => {};

test("a failed fetch followed by success creates the session", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls === 1) throw new TypeError("Load failed");
    return okResponse();
  };
  const session = await postSessionWithRetry(fetchImpl as typeof fetch, { wait: noWait });
  assert.equal(session.sessionId, "s1");
  assert.equal(calls, 2);
});

test("retries are bounded and the final error is human", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new TypeError("Load failed"); };
  await assert.rejects(postSessionWithRetry(fetchImpl as typeof fetch, { wait: noWait, attempts: 3 }), (err: Error) => {
    assert.equal(calls, 3);
    assert.match(sessionCreateErrorMessage(err), /network/i);
    assert.doesNotMatch(sessionCreateErrorMessage(err), /Load failed/);
    return true;
  });
});

test("HTTP 4xx is not retried", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response("no", { status: 401 }); };
  await assert.rejects(postSessionWithRetry(fetchImpl as typeof fetch, { wait: noWait }));
  assert.equal(calls, 1);
});
