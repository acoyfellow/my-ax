import assert from "node:assert/strict";
import test from "node:test";
import { fileOwnerErrorIssue } from "./error-issue";
import { isTransientClientError } from "./transient-client-errors";
import type { Env } from "./types";

test("a voice reconnect and a reconnecting send are transient", () => {
  assert.equal(isTransientClientError("Voice mode: Connection lost. Reconnecting..."), true);
  assert.equal(isTransientClientError("Message not sent: reconnecting. Your draft is still in the composer — retry when the connection is live."), true);
});

test("real failures are not transient", () => {
  assert.equal(isTransientClientError("Voice mode: microphone permission denied"), false);
  assert.equal(isTransientClientError("Could not create session: Load failed"), false);
  assert.equal(isTransientClientError("Unauthorized"), false);
});

test("a transient client error never reaches GitHub", async () => {
  const calls: string[] = [];
  const post = (async (input: RequestInfo | URL) => { calls.push(String(input)); return new Response("{}", { status: 500 }); }) as typeof fetch;
  const env = { GITHUB_TOKEN: "token", DB: {} } as unknown as Env;
  const result = await fileOwnerErrorIssue(env, "owner@example.com", { message: "Voice mode: Connection lost. Reconnecting...", origin: "client" }, post);
  assert.deepEqual(result, { skipped: "transient" });
  assert.deepEqual(calls, []);
});
