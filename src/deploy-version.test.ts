import assert from "node:assert/strict";
import test from "node:test";
import { deploymentVersionResponse } from "./deploy-version";

test("deployment probe returns a bodyless version receipt without storage work", () => {
  const response = deploymentVersionResponse({ id: "new-build", timestamp: "2026-07-08T12:00:00Z" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("etag"), '"new-build"');
  assert.equal(response.headers.get("x-my-ax-version"), "new-build");
  assert.equal(response.headers.get("x-my-ax-version-timestamp"), "2026-07-08T12:00:00Z");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.body, null);
});

test("deployment probe answers 304 when the client already has this build", () => {
  assert.equal(deploymentVersionResponse({ id: "same" }, '"same"').status, 304);
  assert.equal(deploymentVersionResponse({ id: "same" }, 'W/"same"').status, 304);
});

test("deployment probe reports a different build", () => {
  const response = deploymentVersionResponse({ id: "next" }, '"current"');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-my-ax-version"), "next");
});
