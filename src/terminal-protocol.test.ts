import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS,
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  boundedDimension,
  encodeKeystrokes,
  isStatusFrame,
  isWebSocketUpgrade,
  resizeFrame,
  terminalDimensions,
  usableTerminalGrid,
} from "./terminal-protocol";

test("keystrokes encode to bytes, because the container writes binary frames to the pty and parses text frames as control json", () => {
  const encoded = encodeKeystrokes("echo hi\n");
  assert.ok(encoded instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(encoded), "echo hi\n");
});

test("a resize frame is the only control message the container understands", () => {
  const frame = JSON.parse(resizeFrame(120, 40)) as { type: string; cols: number; rows: number };
  assert.equal(frame.type, "resize");
  assert.equal(frame.cols, 120);
  assert.equal(frame.rows, 40);
});

test("a resize frame refuses non-positive dimensions, which the container rejects", () => {
  assert.throws(() => resizeFrame(0, 40));
  assert.throws(() => resizeFrame(120, -1));
  assert.throws(() => resizeFrame(1.5, 40));
});

test("dimensions fall back and clamp instead of trusting the query string", () => {
  assert.equal(boundedDimension("100", 80, 500), 100);
  assert.equal(boundedDimension("", 80, 500), 80);
  assert.equal(boundedDimension("abc", 80, 500), 80);
  assert.equal(boundedDimension("-5", 80, 500), 80);
  assert.equal(boundedDimension("99999", 80, 500), 500);
});

test("terminalDimensions applies the documented defaults and ceilings", () => {
  assert.deepEqual(terminalDimensions({}), { cols: TERMINAL_DEFAULT_COLS, rows: TERMINAL_DEFAULT_ROWS });
  assert.deepEqual(terminalDimensions({ cols: "999999", rows: "999999" }), { cols: TERMINAL_MAX_COLS, rows: TERMINAL_MAX_ROWS });
});

test("a one-column or unmeasured grid is not live enough to open the pty", () => {
  assert.equal(usableTerminalGrid(1, 24), false);
  assert.equal(usableTerminalGrid(39, 24), false);
  assert.equal(usableTerminalGrid(40, 24), true);
  assert.equal(usableTerminalGrid(80, 0), false);
});

test("only a websocket upgrade opens the terminal", () => {
  assert.equal(isWebSocketUpgrade("websocket"), true);
  assert.equal(isWebSocketUpgrade("WebSocket"), true);
  assert.equal(isWebSocketUpgrade("h2c"), false);
  assert.equal(isWebSocketUpgrade(undefined), false);
  assert.equal(isWebSocketUpgrade(null), false);
});

test("status frames are text json and pty output is not", () => {
  assert.equal(isStatusFrame(JSON.stringify({ type: "ready" })), true);
  assert.equal(isStatusFrame(JSON.stringify({ type: "error", message: "x" })), true);
  assert.equal(isStatusFrame("user@my-ax:/home/user $ "), false);
  assert.equal(isStatusFrame(new Uint8Array([1, 2, 3])), false);
});

test("the terminal route refuses a non-upgrade request and never persists terminal bytes", () => {
  const source = readFileSync(new URL("./routes/terminal.ts", import.meta.url), "utf8");
  assert.match(source, /UPGRADE_REQUIRED/, "the route must refuse a plain GET");
  assert.match(source, /426/, "the refusal must be 426");
  assert.doesNotMatch(source, /\/api\/errors/, "terminal bytes must never be posted to the error queue");
  assert.doesNotMatch(source, /INSERT INTO (session_entries|messages)/i, "terminal bytes must never be written to a transcript");
});

test("the live gate asserts the pty, the auth refusal, and the leak scan", () => {
  const gate = readFileSync(new URL("../proof/terminal-live.sh", import.meta.url), "utf8");
  assert.match(gate, /terminal-upgrade-probe\.mjs/, "the gate must upgrade the real terminal endpoint");
  assert.match(gate, /without a valid Access token/, "the gate must prove the door is gated");
  assert.match(gate, /leaked into the error queue/, "the gate must scan the error queue");
  assert.match(gate, /leaked into transcript/, "the gate must scan transcripts");
  assert.doesNotMatch(gate, /workspace\/terminal-probe/, "the gate must not depend on a deleted probe route");
});

test("the upgrade probe requires a 101 and real pty bytes, not just a reachable socket", () => {
  const probe = readFileSync(new URL("../proof/terminal-upgrade-probe.mjs", import.meta.url), "utf8");
  assert.match(probe, /statusCode === 101/, "the probe must require a protocol switch");
  assert.match(probe, /isBinary/, "the probe must require binary pty output");
  assert.match(probe, /without a 101 upgrade/, "binary bytes without an upgrade must fail");
});

test("the spike debris routes are gone and the recovery route stays", () => {
  const routes = readFileSync(new URL("./routes/terminal.ts", import.meta.url), "utf8");
  for (const debris of ["terminal-probe", "restore-probe", "transport-probe"]) {
    assert.doesNotMatch(routes, new RegExp(debris), `${debris} was spike debris and must not come back`);
  }
  assert.match(routes, /\/api\/workspace\/recycle/, "recycle is the only recovery path for a wedged container");
});
