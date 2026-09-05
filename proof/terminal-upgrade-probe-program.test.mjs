import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { Effect } from "effect";
import { terminalSocketLayer } from "./terminal-socket.mjs";
import { runTerminalUpgradeProbe } from "./terminal-upgrade-probe-program.mjs";

class FakeSocket extends EventEmitter {
  constructor(events) {
    super();
    this.closed = false;
    queueMicrotask(() => {
      for (const [name, ...args] of events) this.emit(name, ...args);
    });
  }

  close() {
    this.closed = true;
  }
}

function program(events, sockets) {
  return runTerminalUpgradeProbe({
    host: "https://ax.example.com",
    token: "secret-token",
    timeoutMs: 1000,
  }).pipe(Effect.provide(terminalSocketLayer((url, options) => {
    assert.equal(url, "wss://ax.example.com/api/workspace/terminal?cols=80&rows=24");
    assert.equal(options.headers["cf-access-token"], "secret-token");
    const socket = new FakeSocket(events);
    sockets.push(socket);
    return socket;
  })));
}

test("upgrade probe is lazy and releases its socket after binary PTY output", async () => {
  const sockets = [];
  const probe = program([["upgrade", { statusCode: 101 }], ["message", Buffer.from("prompt"), true]], sockets);
  assert.equal(sockets.length, 0);
  const result = await Effect.runPromise(probe);
  assert.match(result, /upgraded \(101\)/);
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].closed, true);
});

test("upgrade probe fails closed and releases its socket when bytes precede upgrade", async () => {
  const sockets = [];
  await assert.rejects(
    () => Effect.runPromise(program([["message", Buffer.from("prompt"), true]], sockets)),
    /TerminalUpgradeError|without a 101 upgrade/,
  );
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].closed, true);
});
