import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { Effect } from "effect";
import { runTerminalGhProbe } from "./terminal-gh-probe-program.mjs";
import { terminalSocketLayer } from "./terminal-socket.mjs";

class FakeSocket extends EventEmitter {
  constructor(output) {
    super();
    this.output = output;
    this.closed = false;
    queueMicrotask(() => this.emit("open"));
  }

  send() {
    queueMicrotask(() => this.emit("message", Buffer.from(this.output), true));
  }

  close() {
    this.closed = true;
  }
}

function program(output, sockets) {
  return runTerminalGhProbe({
    host: "https://ax.example.com",
    token: "secret-token",
    initialDelayMs: 0,
    pollDelayMs: 0,
    attempts: 2,
    timeoutMs: 1000,
  }).pipe(Effect.provide(terminalSocketLayer((url, options) => {
    assert.equal(url, "wss://ax.example.com/api/workspace/terminal?cols=100&rows=30");
    assert.equal(options.headers["cf-access-token"], "secret-token");
    const socket = new FakeSocket(output);
    sockets.push(socket);
    return socket;
  })));
}

test("terminal gh probe is lazy and closes its socket after success", async () => {
  const sockets = [];
  const probe = program("/usr/bin/gh\ngh version 2.63.2\n", sockets);
  assert.equal(sockets.length, 0);
  const summary = await Effect.runPromise(probe);
  assert.equal(summary, "gh version 2.63.2");
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].closed, true);
});

test("terminal gh probe closes its socket when validation fails", async () => {
  const sockets = [];
  await assert.rejects(
    () => Effect.runPromise(program("/home/user/.local/bin/gh\ngh version 2.63.2\n", sockets)),
    /TerminalProbeError|workspace-local/,
  );
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].closed, true);
});
