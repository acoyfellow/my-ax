import assert from "node:assert/strict";
import test from "node:test";
import { shouldSendToRoot } from "./composer-route";

test("the page composer sends to root only while the root drawer is the target and root is ready", () => {
  const send = () => {};
  assert.equal(shouldSendToRoot(true, { target: "root", sendToRoot: send }), true);
  assert.equal(shouldSendToRoot(true, { target: "page", sendToRoot: send }), false);
  assert.equal(shouldSendToRoot(true, { target: "root", sendToRoot: null }), false);
});

test("root's own embedded chat never forwards to itself", () => {
  assert.equal(shouldSendToRoot(false, { target: "root", sendToRoot: () => {} }), false);
});
