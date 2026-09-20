import assert from "node:assert/strict";
import test from "node:test";
import { resolveToolResultWidget } from "./tool-result-widgets";

test("create_computer receipts become an allowlisted iframe widget", () => {
  const widget = resolveToolResultWidget(JSON.stringify({
    ok: true,
    kind: "named-computer",
    computerId: "desk",
    src: "/api/computers/desk/novnc/vnc.html?autoconnect=1&resize=scale&path=api%2Fcomputers%2Fdesk%2Fnovnc%2Fwebsockify",
    title: "desk",
  }));
  assert.equal(widget.kind, "named-computer");
  if (widget.kind === "named-computer") {
    assert.equal(widget.computerId, "desk");
    assert.match(widget.src, /^\/api\/computers\/desk\/novnc\/vnc\.html/);
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
