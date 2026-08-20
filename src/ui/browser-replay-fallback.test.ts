import assert from "node:assert/strict";
import test from "node:test";
import { resolveToolResultWidget } from "./tool-result-widgets";

const browserRun = (extra: Record<string, unknown> = {}) => ({
  kind: "browser-run",
  status: "done",
  url: "https://example.com",
  title: "Example",
  textPreview: "hello",
  recorded: true,
  recordingFormat: "rrweb",
  note: "recorded",
  ...extra,
});

test("a browser run with screenshot only renders no replay iframe", () => {
  const widget = resolveToolResultWidget(browserRun({
    screenshotSrc: "/api/artifacts/00000000-0000-4000-8000-000000000000",
  }), "browser_open");
  assert.equal(widget.kind, "browser-run");
  assert.equal(widget.replaySrc, undefined);
  assert.ok(widget.screenshotSrc);
});

test("a browser run with a registered replay keeps both sources", () => {
  const widget = resolveToolResultWidget(browserRun({
    replayUrl: "/browser/replay/abc123",
    screenshotSrc: "/api/artifacts/00000000-0000-4000-8000-000000000000",
  }), "browser_open");
  assert.equal(widget.kind, "browser-run");
  assert.equal(widget.replaySrc, "/browser/replay/abc123?embed=1");
  assert.ok(widget.screenshotSrc);
});

test("an external replay url is never embedded", () => {
  const widget = resolveToolResultWidget(browserRun({
    replayUrl: "https://evil.example/replay/abc123",
    screenshotSrc: "/api/artifacts/00000000-0000-4000-8000-000000000000",
  }), "browser_open");
  assert.equal(widget.kind, "browser-run");
  assert.equal(widget.replaySrc, undefined);
  assert.ok(widget.screenshotSrc);
});