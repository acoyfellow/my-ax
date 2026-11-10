import { test } from "node:test";
import * as assert from "node:assert/strict";
import { pillView, clampPosition, nextSessionIndex } from "./miniplayer-pill";

test("pillView: non-minimized with session name under 24 characters", () => {
  const result = pillView({
    sessionName: "Test Session",
    turn: "idle",
    minimized: false
  });
  assert.equal(result.label, "Test Session");
  assert.equal(result.dot, "idle");
  assert.equal(result.showSend, true);
  assert.equal(result.showStop, false);
});

test("pillView: non-minimized with session name over 24 characters", () => {
  const result = pillView({
    sessionName: "This is a very long session name that exceeds 24 chars",
    turn: "working",
    minimized: false
  });
  assert.equal(result.label, "This is a very long sess…");
  assert.equal(result.dot, "working");
  assert.equal(result.showSend, true);
  assert.equal(result.showStop, true);
});

test("pillView: minimized shows state text", () => {
  const result = pillView({
    sessionName: "Some Session Name",
    turn: "offline",
    minimized: true
  });
  assert.equal(result.label, "Offline");
  assert.equal(result.dot, "offline");
  assert.equal(result.showSend, false);
  assert.equal(result.showStop, false);
});

test("pillView: minimized with working state", () => {
  const result = pillView({
    sessionName: "Some Session Name",
    turn: "working",
    minimized: true
  });
  assert.equal(result.label, "Working");
  assert.equal(result.dot, "working");
  assert.equal(result.showSend, false);
  assert.equal(result.showStop, false);
});

test("pillView: minimized with stuck state", () => {
  const result = pillView({
    sessionName: "Some Session Name",
    turn: "stuck",
    minimized: true
  });
  assert.equal(result.label, "Needs you");
  assert.equal(result.dot, "stuck");
  assert.equal(result.showSend, false);
  assert.equal(result.showStop, false);
});

test("pillView: minimized with idle state", () => {
  const result = pillView({
    sessionName: "Some Session Name",
    turn: "idle",
    minimized: true
  });
  assert.equal(result.label, "Idle");
  assert.equal(result.dot, "idle");
  assert.equal(result.showSend, false);
  assert.equal(result.showStop, false);
});

test("pillView: non-minimized stuck state does not show send/stop", () => {
  const result = pillView({
    sessionName: "Test",
    turn: "stuck",
    minimized: false
  });
  assert.equal(result.showSend, false);
  assert.equal(result.showStop, false);
});

test("clampPosition: within viewport bounds", () => {
  const result = clampPosition(100, 100, 800, 600, 200, 100);
  assert.equal(result.x, 100);
  assert.equal(result.y, 100);
});

test("clampPosition: x too small", () => {
  const result = clampPosition(0, 100, 800, 600, 200, 100);
  assert.equal(result.x, 8);
  assert.equal(result.y, 100);
});

test("clampPosition: x too large", () => {
  const result = clampPosition(700, 100, 800, 600, 200, 100);
  assert.equal(result.x, 592); // 800 - 200 - 8
  assert.equal(result.y, 100);
});

test("clampPosition: y too small", () => {
  const result = clampPosition(100, 0, 800, 600, 200, 100);
  assert.equal(result.x, 100);
  assert.equal(result.y, 8);
});

test("clampPosition: y too large", () => {
  const result = clampPosition(100, 550, 800, 600, 200, 100);
  assert.equal(result.x, 100);
  assert.equal(result.y, 492); // 600 - 100 - 8
});

test("clampPosition: both coordinates out of bounds", () => {
  const result = clampPosition(-50, 650, 800, 600, 200, 100);
  assert.equal(result.x, 8);
  assert.equal(result.y, 492); // 600 - 100 - 8
});

test("clampPosition: pill wider than viewport", () => {
  const result = clampPosition(100, 100, 800, 600, 900, 100);
  assert.equal(result.x, 8);
  assert.equal(result.y, 8);
});

test("clampPosition: pill taller than viewport", () => {
  const result = clampPosition(100, 100, 800, 600, 200, 700);
  assert.equal(result.x, 8);
  assert.equal(result.y, 8);
});

test("clampPosition: pill wider and taller than viewport", () => {
  const result = clampPosition(100, 100, 800, 600, 900, 700);
  assert.equal(result.x, 8);
  assert.equal(result.y, 8);
});

test("nextSessionIndex: forward navigation within range", () => {
  const result = nextSessionIndex(0, 5, 1);
  assert.equal(result, 1);
});

test("nextSessionIndex: forward navigation with wraparound", () => {
  const result = nextSessionIndex(4, 5, 1);
  assert.equal(result, 0);
});

test("nextSessionIndex: backward navigation within range", () => {
  const result = nextSessionIndex(3, 5, -1);
  assert.equal(result, 2);
});

test("nextSessionIndex: backward navigation with wraparound", () => {
  const result = nextSessionIndex(0, 5, -1);
  assert.equal(result, 4);
});

test("nextSessionIndex: count of zero", () => {
  const result = nextSessionIndex(5, 0, 1);
  assert.equal(result, 0);
});

test("nextSessionIndex: negative count", () => {
  const result = nextSessionIndex(5, -3, 1);
  assert.equal(result, 0);
});

test("nextSessionIndex: current out of range (too large)", () => {
  const result = nextSessionIndex(10, 5, 1);
  assert.equal(result, 0); // clamped to 4, then +1 wraps to 0
});

test("nextSessionIndex: current out of range (negative)", () => {
  const result = nextSessionIndex(-5, 5, 1);
  assert.equal(result, 1); // clamped to 0, then +1
});

test("nextSessionIndex: single session", () => {
  const result = nextSessionIndex(0, 1, 1);
  assert.equal(result, 0); // wraps to self
});

test("nextSessionIndex: single session backward", () => {
  const result = nextSessionIndex(0, 1, -1);
  assert.equal(result, 0); // wraps to self
});
