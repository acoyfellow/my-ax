import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { Effect } from "effect";
import { runTerminalLiveProof } from "./terminal-live-client-program.mjs";
import { terminalSocketLayer } from "./terminal-socket.mjs";

class FakeSocket extends EventEmitter {
  constructor(state, complete) {
    super();
    this.state = state;
    this.complete = complete;
    this.closed = false;
    queueMicrotask(() => {
      this.emit("open");
      this.emit("message", Buffer.from(complete ? '{"type":"ready"}\nuser@my-ax:$ ' : "partial"), true);
    });
  }

  send(value) {
    const text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
    if (text.startsWith("export PTY_GATE_MARKER=")) this.state.marker = text.trim().split("=")[1];
    if (text.startsWith("echo CANARY_$")) queueMicrotask(() => this.emit("message", Buffer.from("CANARY_42\n"), true));
    if (text === "stty size\n") queueMicrotask(() => this.emit("message", Buffer.from("40 120\n"), true));
    if (text.startsWith("echo survived:")) queueMicrotask(() => this.emit("message", Buffer.from(`survived:${this.state.marker}\n`), true));
  }

  close() {
    this.closed = true;
  }
}

function program(complete, sockets) {
  const state = { marker: "" };
  return runTerminalLiveProof({
    host: "https://ax.example.com",
    token: "secret-token",
    canary: "CANARY",
    initialDelayMs: 0,
    commandDelayMs: 0,
    exportDelayMs: 0,
    resizeDelayMs: 0,
    resizeProbeDelayMs: 0,
    reconnectDelayMs: 0,
    reconnectReadyDelayMs: 0,
    connectTimeoutMs: 1000,
    timeoutMs: 2000,
  }).pipe(Effect.provide(terminalSocketLayer((url, options) => {
    assert.equal(url, "wss://ax.example.com/api/workspace/terminal?cols=80&rows=24");
    assert.equal(options.headers["cf-access-token"], "secret-token");
    const socket = new FakeSocket(state, complete);
    sockets.push(socket);
    return socket;
  })));
}

test("live terminal proof is lazy and releases both reconnect sockets", async () => {
  const sockets = [];
  const proof = program(true, sockets);
  assert.equal(sockets.length, 0);
  const result = await Effect.runPromise(proof);
  assert.deepEqual(result.failures, []);
  assert.equal(result.checks.length, 8);
  assert.equal(sockets.length, 2);
  assert.ok(sockets.every((socket) => socket.closed));
});

test("live terminal proof reports assertion failures and still releases sockets", async () => {
  const sockets = [];
  const result = await Effect.runPromise(program(false, sockets));
  assert.ok(result.failures.includes("the pty announces itself ready"));
  assert.ok(result.failures.includes("the shell paints a prompt"));
  assert.equal(sockets.length, 2);
  assert.ok(sockets.every((socket) => socket.closed));
});
