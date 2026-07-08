import assert from "node:assert/strict";
import test from "node:test";
import { captureConfig, frameFilename, frameDimensions } from "./webcam-frame";

test("captureConfig is bounded JPEG well under the upload cap", () => {
  const c = captureConfig();
  assert.equal(c.mimeType, "image/jpeg");
  assert.ok(c.maxWidth >= 640 && c.maxWidth <= 1920);
  assert.ok(c.quality > 0 && c.quality <= 0.9);
});

test("frameFilename is a stable, sortable jpg name", () => {
  assert.equal(frameFilename(1700000000000), "webcam-1700000000000.jpg");
  assert.match(frameFilename(), /^webcam-\d+\.jpg$/);
});

test("frameDimensions preserves aspect and clamps landscape width", () => {
  const d = frameDimensions(1920, 1080);
  assert.deepEqual(d, { width: 1280, height: 720 });
});

test("frameDimensions clamps portrait by width too", () => {
  const d = frameDimensions(1440, 2560);
  assert.ok(d && d.width === 1280);
  assert.equal(d!.height, Math.round(2560 * (1280 / 1440)));
});

test("frameDimensions leaves small sources unscaled", () => {
  assert.deepEqual(frameDimensions(640, 480), { width: 640, height: 480 });
});

test("frameDimensions guards zero/invalid sources (no frame yet)", () => {
  assert.equal(frameDimensions(0, 480), null);
  assert.equal(frameDimensions(640, 0), null);
  assert.equal(frameDimensions(-1, -1), null);
});
