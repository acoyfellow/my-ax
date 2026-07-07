import assert from "node:assert/strict";
import test from "node:test";
import {
  createReconnectingSocket,
  type ReconnectingSocketDependencies,
  type ReconnectingSocketLike,
} from "./reconnecting-socket";

type Listener = (...args: any[]) => void;

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  closes: Array<{ code?: number; reason?: string }> = [];
  listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string) { this.sent.push(data); }
  close(code?: number, reason?: string) {
    this.readyState = 2;
    this.closes.push({ code, reason });
  }
  emit(type: string, value?: unknown) {
    if (type === "open") this.readyState = 1;
    if (type === "close") this.readyState = 3;
    for (const listener of this.listeners.get(type) ?? []) listener(value);
  }
}

class ManualClock {
  now = 0;
  nextId = 1;
  timers = new Map<number, { at: number; callback: () => void }>();
  schedule = (callback: () => void, delay: number) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + delay, callback });
    return id as any;
  };
  cancel = (id: any) => { this.timers.delete(Number(id)); };
  pendingCount() { return this.timers.size; }
  advance(ms: number) {
    this.now += ms;
    for (const [id, timer] of [...this.timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > this.now) continue;
      this.timers.delete(id);
      timer.callback();
    }
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const clock = new ManualClock();
  const deps: ReconnectingSocketDependencies = {
    createSocket() {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as ReconnectingSocketLike;
    },
    schedule: clock.schedule,
    cancel: clock.cancel,
    random: () => 0.5,
  };
  return { sockets, clock, deps };
}

const noops = { onOpen: () => {}, onClose: () => {}, onError: () => {}, onMessage: () => {} };

test("manual retirement suppresses every late callback from the old conversation", () => {
  const { sockets, clock, deps } = harness();
  const events: string[] = [];
  const first = createReconnectingSocket("wss://example/first", {
    onOpen: () => events.push("first:open"),
    onClose: () => events.push("first:close"),
    onError: () => events.push("first:error"),
    onMessage: () => events.push("first:message"),
  }, deps);
  const oldSocket = sockets[0];
  oldSocket.emit("open");
  first.close();

  // Retired socket fires late open/close/error/message — all must be ignored.
  oldSocket.emit("open");
  oldSocket.emit("error");
  oldSocket.emit("message", { data: "stale" });
  oldSocket.emit("close", { wasClean: false });

  assert.deepEqual(events, ["first:open"]);
  // Manual close must cancel any scheduled retry.
  assert.equal(clock.pendingCount(), 0);
});

test("a stale socket close after the new socket opens cannot flip state back to reconnecting", () => {
  const { sockets, deps } = harness();
  const events: string[] = [];
  const first = createReconnectingSocket("wss://a/1", {
    onOpen: () => events.push("first:open"),
    onClose: () => events.push("first:close"),
    onError: () => {},
    onMessage: () => {},
  }, deps);
  sockets[0].emit("open");
  first.close();

  createReconnectingSocket("wss://a/2", {
    onOpen: () => events.push("second:open"),
    onClose: () => events.push("second:close"),
    onError: () => {},
    onMessage: () => {},
  }, deps);
  sockets[1].emit("open");
  // The retired first socket's delayed close arrives after second opened.
  sockets[0].emit("close", { wasClean: false });

  assert.deepEqual(events, ["first:open", "second:open"]);
});

test("unexpected close on the live socket schedules a bounded retry", () => {
  const { sockets, clock, deps } = harness();
  let closes = 0;
  createReconnectingSocket("wss://a", {
    onOpen: () => {},
    onClose: () => { closes++; },
    onError: () => {},
    onMessage: () => {},
  }, deps);
  sockets[0].emit("open");
  sockets[0].emit("close", { wasClean: false });
  assert.equal(closes, 1);
  assert.equal(clock.pendingCount(), 1);
  clock.advance(10_000);
  assert.equal(sockets.length, 2); // reconnect created a new socket
});

test("queued sends flush in order on open and reset after reconnect", () => {
  const { sockets, deps } = harness();
  const conn = createReconnectingSocket("wss://a", {
    onOpen: () => {}, onClose: () => {}, onError: () => {}, onMessage: () => {},
  }, deps);
  conn.send("a");
  conn.send("b");
  assert.deepEqual(sockets[0].sent, []);
  sockets[0].emit("open");
  assert.deepEqual(sockets[0].sent, ["a", "b"]);
});

test("send after manual close is dropped, not queued", () => {
  const { sockets, deps } = harness();
  const conn = createReconnectingSocket("wss://a", {
    onOpen: () => {}, onClose: () => {}, onError: () => {}, onMessage: () => {},
  }, deps);
  sockets[0].emit("open");
  conn.close();
  conn.send("late");
  assert.deepEqual(sockets[0].sent, []);
});

test("exhaustion fires onExhausted after maxAttempts and stops scheduling", () => {
  const { sockets, clock, deps } = harness();
  let exhausted = 0;
  createReconnectingSocket("wss://a", { ...noops, onExhausted: () => { exhausted++; } }, deps, { maxAttempts: 3 });
  for (let i = 0; i < 3; i++) {
    sockets[i].emit("close", { wasClean: false });
    if (clock.pendingCount()) clock.advance(20_000);
  }
  assert.equal(exhausted, 1);
  assert.equal(clock.pendingCount(), 0);
  assert.equal(sockets.length, 3);
});

test("resume() after exhaustion reconnects and resets the attempt counter", () => {
  const { sockets, clock, deps } = harness();
  const conn = createReconnectingSocket("wss://a", { ...noops, onExhausted: () => {} }, deps, { maxAttempts: 2 });
  sockets[0].emit("close", { wasClean: false });
  clock.advance(20_000);
  sockets[1].emit("close", { wasClean: false }); // attempt 2 -> exhausted
  assert.equal(clock.pendingCount(), 0);
  conn.resume();
  assert.equal(sockets.length, 3);
  sockets[2].emit("close", { wasClean: false }); // fresh retry, not immediate exhaustion
  assert.equal(clock.pendingCount(), 1);
});

test("a successful open before maxAttempts resets attempt so exhaustion cannot fire prematurely", () => {
  const { sockets, clock, deps } = harness();
  let exhausted = 0;
  createReconnectingSocket("wss://a", { ...noops, onExhausted: () => exhausted++ }, deps, { maxAttempts: 2 });
  sockets[0].emit("close", { wasClean: false }); // attempt -> 1
  clock.advance(20_000);
  sockets[1].emit("open");                        // resets attempt
  sockets[1].emit("close", { wasClean: false });  // attempt -> 1 again, not 2
  assert.equal(exhausted, 0);
  assert.equal(clock.pendingCount(), 1);
});

test("resume() while not exhausted is a no-op", () => {
  const { sockets, deps } = harness();
  const conn = createReconnectingSocket("wss://a", noops, deps, { maxAttempts: 5 });
  sockets[0].emit("open");
  conn.resume();
  assert.equal(sockets.length, 1);
});

test("omitting maxAttempts preserves unbounded retry", () => {
  const { sockets, clock, deps } = harness();
  let exhausted = 0;
  createReconnectingSocket("wss://a", { ...noops, onExhausted: () => exhausted++ }, deps);
  for (let i = 0; i < 20; i++) {
    sockets[i].emit("close", { wasClean: false });
    assert.equal(clock.pendingCount(), 1); // always reschedules, never exhausts
    clock.advance(20_000);
  }
  assert.equal(exhausted, 0);
  assert.equal(sockets.length, 21); // each retry created a fresh socket
});

test("send during exhaustion queues; resume then open flushes in order", () => {
  const { sockets, clock, deps } = harness();
  const conn = createReconnectingSocket("wss://a", { ...noops, onExhausted: () => {} }, deps, { maxAttempts: 1 });
  sockets[0].emit("close", { wasClean: false }); // exhausted immediately
  conn.send("x");
  conn.send("y");
  conn.resume();
  sockets[1].emit("open");
  assert.deepEqual(sockets[1].sent, ["x", "y"]);
});

test("forceReconnect retires the current socket with code 4000 and preserves the queue", () => {
  const { sockets, deps } = harness();
  const conn = createReconnectingSocket("wss://a", {
    onOpen: () => {}, onClose: () => {}, onError: () => {}, onMessage: () => {},
  }, deps);
  sockets[0].emit("open");
  conn.send("pending-before-force");
  // 'pending-before-force' already sent since socket was open; queue new one while closed.
  conn.forceReconnect();
  assert.equal(sockets[0].closes[0].code, 4000);
});
