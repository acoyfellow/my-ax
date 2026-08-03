import assert from "node:assert/strict";
import test from "node:test";

// Reproduces the service-worker notificationclick ack-with-fallback contract
// in isolation. The SW posts my-ax:navigate to an open client and waits up to
// a timeout for a my-ax:navigate-ack; only if none arrives does it hard
// .navigate(). This proves it never double-navigates when the app is alive.

type SwListener = (event: { data: any }) => void;

function makeSwHarness() {
  const listeners: SwListener[] = [];
  const self = {
    addEventListener: (_: string, fn: SwListener) => listeners.push(fn),
    removeEventListener: (_: string, fn: SwListener) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  const deliver = (data: any) => listeners.slice().forEach((fn) => fn({ data }));
  return { self, deliver, listenerCount: () => listeners.length };
}

async function runNotificationClick(
  self: ReturnType<typeof makeSwHarness>["self"],
  existing: { postMessage(msg: any): void; navigate(): Promise<void>; focus(): Promise<void> },
  absolute: string,
  timeoutMs: number,
) {
  const target = new URL(absolute);
  if (target.pathname === "/" && !target.search && !target.hash) {
    await existing.focus();
    return true;
  }
  const acked = await new Promise<boolean>((resolve) => {
    const onAck = (ev: { data: any }) => {
      if (ev.data?.type === "my-ax:navigate-ack" && ev.data?.href === absolute) {
        self.removeEventListener("message", onAck);
        resolve(true);
      }
    };
    self.addEventListener("message", onAck);
    existing.postMessage({ type: "my-ax:navigate", href: absolute });
    setTimeout(() => { self.removeEventListener("message", onAck); resolve(false); }, timeoutMs);
  });
  if (!acked) await existing.navigate();
  return acked;
}

test("SW does not hard-navigate when the client acks the in-page switch", async () => {
  const { self, deliver, listenerCount } = makeSwHarness();
  let navigated = 0;
  const href = "https://x/?session=abc";
  const existing = {
    postMessage(msg: any) {
      if (msg.type === "my-ax:navigate") setTimeout(() => deliver({ type: "my-ax:navigate-ack", href: msg.href }), 5);
    },
    async navigate() { navigated++; },
    async focus() {},
  };
  const acked = await runNotificationClick(self, existing, href, 400);
  assert.equal(acked, true);
  assert.equal(navigated, 0);
  assert.equal(listenerCount(), 0); // listener cleaned up
});

test("SW falls back to navigate when the client cannot ack", async () => {
  const { self, listenerCount } = makeSwHarness();
  let navigated = 0;
  const existing = {
    postMessage() {}, // client not listening
    async navigate() { navigated++; },
    async focus() {},
  };
  const acked = await runNotificationClick(self, existing, "https://x/?session=target", 30);
  assert.equal(acked, false);
  assert.equal(navigated, 1);
  assert.equal(listenerCount(), 0);
});

test("an informational root push focuses the existing client without posting or navigating", async () => {
  const { self, listenerCount } = makeSwHarness();
  let posted = 0;
  let navigated = 0;
  let focused = 0;
  const existing = {
    postMessage() { posted++; },
    async navigate() { navigated++; },
    async focus() { focused++; },
  };
  const handled = await runNotificationClick(self, existing, "https://x/", 30);
  assert.equal(handled, true);
  assert.equal(posted, 0);
  assert.equal(navigated, 0);
  assert.equal(focused, 1);
  assert.equal(listenerCount(), 0);
});
