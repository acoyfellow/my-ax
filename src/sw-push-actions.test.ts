import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { buildOwnerPushPayload, decisionNotificationTag } from "./notify";
import { recurringJobReceipt } from "./recurring-job-receipt";

type Shown = { title: string; tag: string; data?: unknown; actions?: unknown; closed: boolean; close(): void };

function worker(fetchResult: { ok: boolean; status: number } = { ok: true, status: 200 }) {
  const listeners = new Map<string, (event: any) => void>();
  const shown: Shown[] = [];
  const fetches: Array<{ input: string; init: RequestInit }> = [];
  const badges: number[] = [];
  const messages: unknown[] = [];
  const registration = {
    async showNotification(title: string, options: Record<string, unknown>) {
      const notification: Shown = { title, tag: String(options.tag ?? ""), data: options.data, actions: options.actions, closed: false, close() { notification.closed = true; } };
      shown.push(notification);
    },
    async getNotifications() { return shown.filter((notification) => !notification.closed); },
    async setAppBadge(count: number) { badges.push(count); },
    async clearAppBadge() { badges.push(0); },
  };
  runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    self: { addEventListener: (type: string, listener: (event: any) => void) => listeners.set(type, listener), removeEventListener() {}, skipWaiting() {}, registration, navigator: {}, clients: { async claim() {} }, location: { origin: "https://my-ax.test" } },
    clients: { async matchAll() { return [{ url: "https://my-ax.test/", focused: true, postMessage: (message: unknown) => messages.push(message), focus: async () => undefined, navigate: async () => undefined }]; }, async openWindow() { return undefined; } },
    caches: { async keys() { return []; }, async delete() { return true; } },
    fetch: async (input: string, init: RequestInit) => { fetches.push({ input, init }); return fetchResult; },
    URL, Promise, setTimeout, console,
  });
  const run = async (type: string, event: Record<string, unknown>) => {
    let work: Promise<unknown> | undefined;
    listeners.get(type)!({ ...event, waitUntil(promise: Promise<unknown>) { work = promise; } });
    await work;
  };
  return {
    shown, fetches, badges, messages,
    push: (payload: unknown) => run("push", { data: { json: () => payload } }),
    click: (action: string, notification: Shown) => run("notificationclick", { action, notification }),
  };
}

const DECISION = "run-decision-11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";

test("a decision push uses the decision tag so an answer anywhere can close it", async () => {
  const { payload } = buildOwnerPushPayload(
    { kind: "job.needs_input", title: "Needs input", body: "Ship?", href: `/?session=s&decision=${DECISION}`, decision: { id: DECISION, options: ["Ship", "Hold"] } },
    { destinationHref: `/?session=s&decision=${DECISION}`, attentionId: "a1", unread: 1, progressTerminal: false },
  );
  assert.equal(payload.tag, decisionNotificationTag(DECISION));
  const sw = worker();
  await sw.push(payload);
  assert.equal(sw.shown[0]?.tag, `decision:${DECISION}`);
});

test("a close push closes the matching notification, shows nothing new and updates the badge", async () => {
  const sw = worker();
  await sw.push({ title: "Needs input", body: "Ship?", tag: `decision:${DECISION}`, unread: 2 });
  await sw.push({ title: "Other", body: "x", attentionId: "other", unread: 2 });
  await sw.push({ type: "close", dismissTags: [`decision:${DECISION}`], unread: 1 });
  assert.equal(sw.shown.length, 2);
  assert.equal(sw.shown[0]?.closed, true);
  assert.equal(sw.shown[1]?.closed, false);
  assert.equal(sw.badges.at(-1), 1);
  assert.ok(sw.messages.some((message) => (message as { type?: string }).type === "my-ax:attention"));
});

test("a failed recurring job push offers Retry now and Pause job; a success does not", () => {
  const failed = recurringJobReceipt({ jobId: JOB, sessionId: "s", error: "boom", ranAt: new Date(0) });
  const ok = recurringJobReceipt({ jobId: JOB, sessionId: "s", ranAt: new Date(0) });
  const failedPayload = buildOwnerPushPayload(failed, { destinationHref: "/?session=s", attentionId: "a", unread: 1, progressTerminal: false }).payload;
  const okPayload = buildOwnerPushPayload(ok, { destinationHref: "/?session=s", attentionId: "a", unread: 1, progressTerminal: false }).payload;
  assert.deepEqual(failedPayload.actions.map((action) => action.action), ["job:run", "job:pause"]);
  assert.deepEqual(failedPayload.job, { id: JOB });
  assert.equal(okPayload.job, undefined);
  assert.notDeepEqual(okPayload.actions.map((action) => action.action), ["job:run", "job:pause"]);
});

for (const [action, verb, title] of [["job:run", "run", "Job retry started"], ["job:pause", "pause", "Job paused"]] as const) {
  test(`${action} posts to the job ${verb} endpoint and confirms`, async () => {
    const sw = worker();
    await sw.push({ title: "Job failed", body: "boom", attentionId: "a", href: "/?session=s", job: { id: JOB }, actions: [{ action: "job:run", title: "Retry now" }, { action: "job:pause", title: "Pause job" }] });
    const notification = sw.shown[0]!;
    await sw.click(action, notification);
    assert.equal(sw.fetches[0]?.input, `/api/jobs/${JOB}/${verb}`);
    assert.equal(sw.fetches[0]?.init.method, "POST");
    assert.equal(sw.fetches[0]?.init.credentials, "include");
    assert.equal(notification.closed, true);
    assert.equal(sw.shown.at(-1)?.title, title);
  });
}

test("a failed job action says it was not recorded", async () => {
  const sw = worker({ ok: false, status: 401 });
  await sw.push({ title: "Job failed", body: "boom", attentionId: "a", href: "/?session=s", job: { id: JOB } });
  await sw.click("job:run", sw.shown[0]!);
  assert.equal(sw.shown.at(-1)?.title, "Job action not recorded");
});

test("a job action with a bad id never calls the API", async () => {
  const sw = worker();
  await sw.push({ title: "Job failed", body: "boom", attentionId: "a", href: "/?session=s", job: { id: "../../x" } });
  await sw.click("job:pause", sw.shown[0]!);
  assert.equal(sw.fetches.length, 0);
});
