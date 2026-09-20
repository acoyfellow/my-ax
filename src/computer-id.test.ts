import assert from "node:assert/strict";
import test from "node:test";
import { computerPreviewSrc, computerSandboxName, normalizeComputerId, novncContainerPath } from "./computer-id";

test("computer ids are lowercase hyphenated names", () => {
  assert.equal(normalizeComputerId("Lab-1"), "lab-1");
  assert.throws(() => normalizeComputerId("Bad Id"), /computer id/);
  assert.throws(() => normalizeComputerId(""), /computer id/);
});

test("sandbox names isolate computers from the owner workspace", () => {
  assert.equal(computerSandboxName("Owner@Example.com", "lab-1"), "owner@example.com::computer::lab-1");
  assert.notEqual(computerSandboxName("a@b.c", "one"), "a@b.c");
});

test("novnc proxy paths cannot escape the computer prefix", () => {
  assert.equal(novncContainerPath("/api/computers/desk/novnc/vnc.html", "desk"), "/vnc.html");
  assert.equal(novncContainerPath("/api/computers/desk/novnc/websockify", "desk"), "/websockify");
  assert.throws(() => novncContainerPath("/api/computers/desk/novnc/../etc/passwd", "desk"), /not allowed/);
  assert.throws(() => novncContainerPath("/api/computers/other/novnc/vnc.html", "desk"), /outside/);
});

test("iframe src points noVNC websocket at the Worker proxy", () => {
  const src = computerPreviewSrc("desk");
  assert.equal(new URL(src, "https://example.com").searchParams.get("path"), "api/computers/desk/novnc/websockify");
});
