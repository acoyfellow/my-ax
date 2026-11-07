import assert from "node:assert/strict";
import { test } from "node:test";
import { createReconnectingSocket, type ReconnectingSocketDependencies, type ReconnectingSocketLike } from "../ui/reconnecting-socket";
import { initialSocketConnection, nextSocketConnection } from "./socket-connection";

type FakeSocket = ReconnectingSocketLike & { fire(type: string, event?: unknown): void };

function harness(maxAttempts: number) {
  const sockets: FakeSocket[] = [];
  const timers: Array<() => void> = [];
  const dependencies: ReconnectingSocketDependencies = {
    createSocket() {
      const listeners = new Map<string, Array<(event: any) => void>>();
      const socket: FakeSocket = {
        readyState: 0,
        send() {},
        close() {},
        addEventListener(type: string, listener: (event: any) => void) { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
        fire(type: string, event: unknown = {}) { for (const listener of listeners.get(type) ?? []) listener(event); },
      } as FakeSocket;
      sockets.push(socket);
      return socket;
    },
    schedule(callback: () => void) { timers.push(callback); return timers.length as never; },
    cancel() {},
    random: () => 0.5,
  };
  let exhausted = 0;
  const transport = createReconnectingSocket("wss://example.test", {
    onOpen() {}, onClose() {}, onError() {}, onMessage() {}, onExhausted() { exhausted += 1; },
  }, dependencies, { maxAttempts });
  return { transport, sockets, timers, exhaustedCount: () => exhausted };
}

test("forcing a reconnect after the transport gave up opens a new socket", () => {
  const h = harness(1);
  h.sockets[0].fire("close");
  assert.equal(h.exhaustedCount(), 1);
  h.transport.forceReconnect();
  assert.equal(h.sockets.length, 2);
});

test("a retry timer from before a forced reconnect does not open a second socket", () => {
  const h = harness(5);
  h.sockets[0].fire("close");
  h.transport.forceReconnect();
  assert.equal(h.sockets.length, 2);
  h.timers[0]();
  assert.equal(h.sockets.length, 2);
});

test("after close, no event reopens the transport", () => {
  let state = nextSocketConnection(initialSocketConnection(), { type: "close" }).state;
  for (const type of ["opened", "retry_due", "force_reconnect", "resume"] as const) {
    const step = nextSocketConnection(state, { type });
    assert.equal(step.state.kind, "closed");
    assert.equal(step.effect, "none");
    state = step.state;
  }
});
