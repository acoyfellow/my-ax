import assert from "node:assert/strict";
import test from "node:test";
import { resolveToolResultWidget } from "./tool-result-widgets";

test("create_computer receipts become an allowlisted iframe widget", () => {
  const widget = resolveToolResultWidget(JSON.stringify({
    ok: true,
    kind: "named-computer",
    computerId: "desk",
    src: "/api/computers/desk/screen/",
    title: "desk",
  }));
  assert.equal(widget.kind, "named-computer");
  if (widget.kind === "named-computer") {
    assert.equal(widget.computerId, "desk");
    assert.equal(widget.src, "/api/computers/desk/screen/");
  }
});

test("named computer widget rejects a foreign iframe src", () => {
  const widget = resolveToolResultWidget({
    kind: "named-computer",
    computerId: "desk",
    src: "https://evil.example/vnc.html",
    title: "desk",
  });
  assert.equal(widget.kind, "raw-text");
});
