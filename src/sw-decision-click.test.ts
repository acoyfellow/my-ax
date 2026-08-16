import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

type NotificationRecord = {
  tag: string;
  data?: unknown;
  closed: boolean;
  close(): void;
};

type ShowCall = { title: string; options: Record<string, unknown> };

type Harness = {
  click(action: string, data: Record<string, unknown>): Promise<NotificationRecord>;
  fetchCalls: Array<{ input: string; init: RequestInit }>;
  showCalls: ShowCall[];
  badgeCalls: number[];
};

function workerHarness(fetchResult: () => Promise<{ ok: boolean; status: number }>, existing: NotificationRecord[] = []): Harness {
  const listeners = new Map<string, Array<(event: any) => void>>();
  const fetchCalls: Array<{ input: string; init: RequestInit }> = [];
  const showCalls: ShowCall[] = [];
  const badgeCalls: number[] = [];
  const visible = [...existing];
  const addEventListener = (type: string, listener: (event: any) => void) => listeners.set(type, [...(listeners.get(type) ?? []), listener]);
  const removeEventListener = (type: string, listener: (event: any) => void) => listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener));
  const registration = {
    async showNotification(title: string, options: Record<string, unknown>) {
      showCalls.push({ title, options });
      const notification: NotificationRecord = {
        tag: typeof options.tag === "string" ? options.tag : "",
        data: options.data,
        closed: false,
        close() { notification.closed = true; },
      };
      visible.push(notification);
    },
    async getNotifications() { return visible.filter((notification) => !notification.closed); },
    async setAppBadge(count: number) { badgeCalls.push(count); },
    async clearAppBadge() { badgeCalls.push(0); },
  };
  const self = {
    addEventListener,
    removeEventListener,
    skipWaiting() {},
    registration,
    navigator: {},
    clients: { async claim() {} },
    location: { origin: "https://my-ax.test" },
  };
  const clients = {
    async matchAll() { return []; },
    async openWindow() { return undefined; },
  };
  runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    self,
    clients,
    caches: { async keys() { return []; }, async delete() { return true; } },
    fetch: async (input: string, init: RequestInit) => {
      fetchCalls.push({ input, init });
      return fetchResult();
    },
    URL,
    Promise,
    setTimeout,
    console,
  });
  return {
    async click(action, data) {
      const notification: NotificationRecord = {
        tag: "decision-tag",
        data,
        closed: false,
        close() { notification.closed = true; },
      };
      let work: Promise<unknown> | undefined;
      const listener = listeners.get("notificationclick")?.[0];
      assert.ok(listener, "notificationclick listener is registered");
      listener({ action, notification, waitUntil(promise: Promise<unknown>) { work = promise; } });
      assert.ok(work, "click work is retained by waitUntil");
      await work;
      return notification;
    },
    fetchCalls,
    showCalls,
    badgeCalls,
  };
}

const decisionData = {
  decision: {
    id: "run-decision-11111111-1111-4111-8111-111111111111",
    options: ["Ship", "Hold"],
  },
  unread: 3,
};

test("service worker unit harness without an Access identity posts the indexed decision choice with included credentials", async () => {
  const harness = workerHarness(async () => ({ ok: true, status: 200 }));
  const notification = await harness.click("decision:1", decisionData);
  assert.equal(harness.fetchCalls.length, 1);
  const [call] = harness.fetchCalls;
  assert.equal(call.input, "/api/decisions/run-decision-11111111-1111-4111-8111-111111111111/respond");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.credentials, "include");
  assert.equal(new Headers(call.init.headers).get("content-type"), "application/json");
  assert.equal(call.init.body, JSON.stringify({ choice: "Hold" }));
  assert.equal(notification.closed, true);
  assert.deepEqual(harness.badgeCalls, [2]);
});

test("a non-ok decision response produces a visible not-recorded notification", async () => {
  const harness = workerHarness(async () => ({ ok: false, status: 401 }));
  const notification = await harness.click("decision:0", decisionData);
  assert.equal(notification.closed, false);
  assert.equal(harness.showCalls.length, 1);
  assert.equal(harness.showCalls[0]?.title, "Decision not recorded");
  assert.match(String(harness.showCalls[0]?.options.body), /not recorded/);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.showCalls[0]?.options.actions)), [{ action: "open", title: "Open decision" }]);
  assert.equal((harness.showCalls[0]?.options.data as { href?: string }).href, "/api/decisions/run-decision-11111111-1111-4111-8111-111111111111");
});

test("a 409 decision response is visibly reported as already answered", async () => {
  const harness = workerHarness(async () => ({ ok: false, status: 409 }));
  await harness.click("decision:0", decisionData);
  assert.equal(harness.showCalls.length, 1);
  assert.equal(harness.showCalls[0]?.title, "Decision already answered");
  assert.match(String(harness.showCalls[0]?.options.body), /already answered/);
});
