import assert from "node:assert/strict";
import test from "node:test";
import { computerPreviewSrc, computerSandboxName, normalizeComputerId, screenContainerPath } from "./computer-id";

test("computer ids are lowercase hyphenated names", () => {
  assert.equal(normalizeComputerId("Lab-1"), "lab-1");
  assert.throws(() => normalizeComputerId("Bad Id"), /computer id/);
  assert.throws(() => normalizeComputerId(""), /computer id/);
});

test("sandbox names isolate computers from the owner workspace", () => {
  assert.equal(computerSandboxName("Owner@Example.com", "lab-1"), "owner@example.com::computer::lab-1");
  assert.notEqual(computerSandboxName("a@b.c", "one"), "a@b.c");
});

test("screen proxy paths cannot escape the computer prefix", () => {
  assert.equal(screenContainerPath("/api/computers/desk/screen/", "desk"), "/");
  assert.equal(screenContainerPath("/api/computers/desk/screen", "desk"), "/");
  assert.equal(screenContainerPath("/api/computers/desk/screen/ws", "desk"), "/ws");
  assert.equal(screenContainerPath("/api/computers/desk/screen/client.js", "desk"), "/client.js");
  assert.throws(() => screenContainerPath("/api/computers/desk/screen/../etc/passwd", "desk"), /not allowed/);
  assert.throws(() => screenContainerPath("/api/computers/desk/screen//x", "desk"), /not allowed/);
  assert.throws(() => screenContainerPath("/api/computers/other/screen/", "desk"), /outside/);
});

test("iframe src is the voxl page behind the Worker proxy, whose relative ws URL stays on that path", () => {
  const src = computerPreviewSrc("desk");
  assert.equal(src, "/api/computers/desk/screen/");
  assert.equal(new URL("ws", new URL(src, "https://example.com")).pathname, "/api/computers/desk/screen/ws");
});
