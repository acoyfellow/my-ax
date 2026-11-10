import { test } from "node:test";
import * as assert from "node:assert/strict";
import { pipSupport, pipSize, pipLabel } from "./miniplayer-pip";

test("pipSupport - Chromium desktop browsers return 'pip'", () => {
  // Chrome
  assert.equal(
    pipSupport(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "pip"
  );

  // Edge
  assert.equal(
    pipSupport(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
    ),
    "pip"
  );

  // Opera
  assert.equal(
    pipSupport(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0"
    ),
    "pip"
  );

  // Brave
  assert.equal(
    pipSupport(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Brave/1.72.104"
    ),
    "pip"
  );
});

test("pipSupport - Case-insensitive matching", () => {
  assert.equal(
    pipSupport(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) CHROME/120.0.0.0 Safari/537.36"
    ),
    "pip"
  );

  assert.equal(
    pipSupport(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 BRAVE/1.72.104"
    ),
    "pip"
  );
});

test("pipSupport - Mobile Chromium returns 'fallback'", () => {
  // Android Chrome
  assert.equal(
    pipSupport(
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    ),
    "fallback"
  );

  // Mobile with 'mobile' in UA
  assert.equal(
    pipSupport(
      "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    ),
    "fallback"
  );
});

test("pipSupport - Safari returns 'fallback'", () => {
  assert.equal(
    pipSupport(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1.1 Safari/605.1.15"
    ),
    "fallback"
  );
});

test("pipSupport - Firefox returns 'fallback'", () => {
  assert.equal(
    pipSupport(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0"
    ),
    "fallback"
  );
});

test("pipSupport - Empty string returns 'fallback'", () => {
  assert.equal(pipSupport(""), "fallback");
});

test("pipSize - Clamps width to [280, 420]", () => {
  // Below minimum
  const below = pipSize(100);
  assert.equal(below.width, 280);

  // Minimum boundary
  const min = pipSize(280);
  assert.equal(min.width, 280);

  // Within range
  const mid = pipSize(350);
  assert.equal(mid.width, 350);

  // Maximum boundary
  const max = pipSize(420);
  assert.equal(max.width, 420);

  // Above maximum
  const above = pipSize(500);
  assert.equal(above.width, 420);
});

test("pipSize - Height is width * 9/16 rounded to whole pixels", () => {
  // 280: 280 * 9 / 16 = 157.5 → 158
  const size280 = pipSize(280);
  assert.equal(size280.width, 280);
  assert.equal(size280.height, 158);

  // 320: 320 * 9 / 16 = 180
  const size320 = pipSize(320);
  assert.equal(size320.width, 320);
  assert.equal(size320.height, 180);

  // 420: 420 * 9 / 16 = 236.25 → 236
  const size420 = pipSize(420);
  assert.equal(size420.width, 420);
  assert.equal(size420.height, 236);
});

test("pipSize - viewportW <= 0 returns minimum size", () => {
  const zero = pipSize(0);
  assert.equal(zero.width, 280);
  assert.equal(zero.height, 158);

  const negative = pipSize(-100);
  assert.equal(negative.width, 280);
  assert.equal(negative.height, 158);
});

test("pipLabel - 'working' returns 'Working'", () => {
  assert.equal(pipLabel("working"), "Working");
});

test("pipLabel - 'idle' returns 'Idle'", () => {
  assert.equal(pipLabel("idle"), "Idle");
});

test("pipLabel - 'stuck' returns 'Needs you'", () => {
  assert.equal(pipLabel("stuck"), "Needs you");
});
