import assert from "node:assert/strict";
import { test } from "node:test";
import { lastTurnFailed } from "./last-turn-failed";

const user = { kind: "pi.user", model: [{ role: "user", content: "hi" }] };
const ok = { kind: "pi.assistant", model: [{ role: "assistant", stopReason: "stop" }] };
const failed = { kind: "pi.assistant", model: [{ role: "assistant", stopReason: "error", errorMessage: "boom" }] };

test("a chat whose latest reply errored shows as failed", () => assert.equal(lastTurnFailed([user, failed]), true));
test("a later successful reply clears the failure", () => assert.equal(lastTurnFailed([user, failed, user, ok]), false));
test("a new message waiting for its reply is not a failure", () => assert.equal(lastTurnFailed([user, failed, user]), false));
test("an empty chat is not a failure", () => assert.equal(lastTurnFailed([]), false));
