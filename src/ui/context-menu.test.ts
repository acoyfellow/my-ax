import assert from "node:assert/strict";
import { test } from "node:test";
import { clampMenuPosition, submenuPosition } from "./context-menu";

test("clampMenuPosition keeps menus inside viewport bounds", () => {
  assert.deepEqual(
    clampMenuPosition({ x: 1200, y: 800 }, { width: 200, height: 180 }, { width: 1280, height: 860 }),
    { x: 1072, y: 672 },
  );
  assert.deepEqual(
    clampMenuPosition({ x: -20, y: -10 }, { width: 200, height: 180 }, { width: 1280, height: 860 }),
    { x: 8, y: 8 },
  );
});

test("submenuPosition opens right when space fits and flips left near the right edge", () => {
  const right = submenuPosition({ left: 100, top: 200, width: 180, height: 30 }, { width: 160, height: 100 }, { width: 1280, height: 860 });
  assert.equal(right.x, 284);
  const flipped = submenuPosition({ left: 1060, top: 200, width: 180, height: 30 }, { width: 160, height: 100 }, { width: 1280, height: 860 });
  assert.equal(flipped.x, 896);
});
