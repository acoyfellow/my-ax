import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

type NotificationRecord = { tag: string; closed: boolean; close(): void };

function notification(tag: string): NotificationRecord {
  const value: NotificationRecord = {
    tag,
    closed: false,
    close() { value.closed = true; },
  };
  return value;
}

test("dismissal sweep closes matching tags, preserves other notifications, and recomputes the badge", async () => {
  const matching = notification("attention-seen");
  const surviving = notification("attention-open");
  const visible = [matching, surviving];
  const badges: number[] = [];
  const listeners = new Map<string, Array<(event: any) => void>>();
  const registration = {
    async showNotification(_title: string, options: Record<string, unknown>) {
      visible.push(notification(String(options.tag ?? "")));
    },
    async getNotifications() { return visible.filter((item) => !item.closed); },
    async setAppBadge(count: number) { badges.push(count); },
    async clearAppBadge() { badges.push(0); },
  };
  const self = {
    addEventListener(type: string, listener: (event: any) => void) { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
    removeEventListener() {},
    skipWaiting() {},
    registration,
    navigator: {},
    clients: { async claim() {} },
    location: { origin: "https://my-ax.test" },
  };
  runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    self,
    clients: { async matchAll() { return []; }, async openWindow() { return undefined; } },
    caches: { async keys() { return []; }, async delete() { return true; } },
    fetch: async () => ({ ok: true, status: 200 }),
    URL,
    Promise,
    setTimeout,
    console,
  });
  let work: Promise<unknown> | undefined;
  const push = listeners.get("push")?.[0];
  assert.ok(push, "push listener is registered");
  push({
    data: { json: () => ({ title: "New notification", body: "body", attentionId: "attention-new", unread: 8, dismissTags: ["attention-seen"] }) },
    waitUntil(promise: Promise<unknown>) { work = promise; },
  });
  assert.ok(work, "push work is retained by waitUntil");
  await work;
  assert.equal(matching.closed, true);
  assert.equal(surviving.closed, false);
  assert.deepEqual(badges, [2]);
});
