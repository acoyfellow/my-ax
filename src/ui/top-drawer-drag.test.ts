import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dragOffset, settlesOpen } from "./top-drawer-drag";

test("pulling down from the root button reveals the drawer, clamped to its height", () => {
  assert.equal(dragOffset(10, 210, 600, "open"), 200);
  assert.equal(dragOffset(10, 5, 600, "open"), 0);
  assert.equal(dragOffset(10, 900, 600, "open"), 600);
});

test("pushing the handle up closes the drawer from fully open", () => {
  assert.equal(dragOffset(600, 500, 600, "close"), 500);
  assert.equal(dragOffset(600, 700, 600, "close"), 600);
});

test("the drawer settles open past 70 percent and closed below it", () => {
  assert.equal(settlesOpen(450, 600), true);
  assert.equal(settlesOpen(300, 600), false);
  assert.equal(settlesOpen(0, 0), false);
});

test("a fast flick decides the drawer regardless of how far it travelled", async () => {
  const { settlesOpenAfterRelease } = await import("./top-drawer-drag");
  assert.equal(settlesOpenAfterRelease(40, 800, 0.9), true);
  assert.equal(settlesOpenAfterRelease(760, 800, -0.9), false);
  assert.equal(settlesOpenAfterRelease(700, 800, 0), true);
  assert.equal(settlesOpenAfterRelease(200, 800, 0), false);
});

test("velocity uses only the last 100ms of pointer movement", async () => {
  const { velocityOf } = await import("./top-drawer-drag");
  assert.equal(velocityOf([{ y: 0, t: 0 }, { y: 0, t: 500 }, { y: 50, t: 550 }, { y: 100, t: 600 }]), 1);
  assert.equal(velocityOf([{ y: 10, t: 0 }]), 0);
});

test("over-dragging past the end resists and never exceeds the limit", async () => {
  const { rubberBand } = await import("./top-drawer-drag");
  assert.equal(rubberBand(-10), 0);
  assert.ok(rubberBand(30) < 30);
  assert.ok(rubberBand(10_000) <= 60);
  assert.ok(rubberBand(60) > rubberBand(30));
});

test("the app behind the drawer scales down as the drawer reveals", async () => {
  const { backgroundScale, revealProgress } = await import("./top-drawer-drag");
  assert.equal(backgroundScale(0), 1);
  assert.ok(Math.abs(backgroundScale(1) - 0.94) < 1e-9);
  assert.equal(revealProgress(1200, 800), 1);
  assert.equal(revealProgress(-5, 800), 0);
});

test("a still tap on the desk button is left to the native click", async () => {
  const { releaseOutcome } = await import("./top-drawer-drag");
  assert.equal(releaseOutcome({ direction: "open", travel: 3, cancelled: false, offset: 3, height: 800, velocity: 0 }), "tap");
});

test("an iOS pointercancel during a tap or pull never leaves the drawer half open", async () => {
  const { releaseOutcome } = await import("./top-drawer-drag");
  assert.equal(releaseOutcome({ direction: "open", travel: 0, cancelled: true, offset: 0, height: 800, velocity: 0 }), "close");
  assert.equal(releaseOutcome({ direction: "open", travel: 400, cancelled: true, offset: 400, height: 800, velocity: 0 }), "close");
  assert.equal(releaseOutcome({ direction: "close", travel: -2, cancelled: true, offset: 798, height: 800, velocity: 0 }), "open");
});

test("a real pull still settles by distance and flick", async () => {
  const { releaseOutcome } = await import("./top-drawer-drag");
  assert.equal(releaseOutcome({ direction: "open", travel: 700, cancelled: false, offset: 700, height: 800, velocity: 0 }), "open");
  assert.equal(releaseOutcome({ direction: "open", travel: 60, cancelled: false, offset: 60, height: 800, velocity: 1 }), "open");
  assert.equal(releaseOutcome({ direction: "open", travel: 60, cancelled: false, offset: 60, height: 800, velocity: 0 }), "close");
});

test("the desk button opens on the native click, which iOS always delivers", () => {
  const desk = readFileSync(new URL("./Desk.svelte", import.meta.url), "utf8");
  assert.match(desk, /onclick=\{openFromClick\}/);
});
