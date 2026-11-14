import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { confirmAllowed, createAlerts, promptAllowed, type AlertState } from "./alert-queue";

const alertState: AlertState = { queue: [], toasts: [] };
const { confirmDialog, promptDialog, settleCurrent, notify, dismissToast } = createAlerts(alertState);

test("confirm resolves true on OK and false on cancel, in queue order", async () => {
  const first = confirmDialog({ title: "Delete?" });
  const second = confirmDialog({ title: "Again?" });
  assert.equal(alertState.queue.length, 2);
  assert.equal(alertState.queue[0]!.options.title, "Delete?");
  settleCurrent(true);
  settleCurrent(false);
  assert.equal(await first, true);
  assert.equal(await second, false);
  assert.equal(alertState.queue.length, 0);
});

test("prompt resolves the typed text, or null when cancelled", async () => {
  const named = promptDialog({ title: "Rename", value: "old" });
  settleCurrent("new name");
  assert.equal(await named, "new name");
  const cancelled = promptDialog({ title: "Rename" });
  settleCurrent(null);
  assert.equal(await cancelled, null);
});

test("type-to-confirm blocks a destructive OK until the word matches", () => {
  assert.equal(confirmAllowed({ title: "x", typeToConfirm: "delete" }, "del"), false);
  assert.equal(confirmAllowed({ title: "x", typeToConfirm: "delete" }, " delete "), true);
  assert.equal(confirmAllowed({ title: "x" }, ""), true);
});

test("a prompt will not submit blank unless allowed", () => {
  assert.equal(promptAllowed({ title: "x" }, "  "), false);
  assert.equal(promptAllowed({ title: "x", allowEmpty: true }, ""), true);
});

test("toasts can be dismissed", () => {
  const id = notify("Saved", "success");
  assert.ok(alertState.toasts.some((toast) => toast.id === id));
  dismissToast(id);
  assert.ok(!alertState.toasts.some((toast) => toast.id === id));
});

test("no UI file uses the native alert, confirm or prompt", () => {
  const dir = new URL("./", import.meta.url);
  const offenders = readdirSync(dir)
    .filter((name) => name.endsWith(".svelte"))
    .filter((name) => /window\.(alert|confirm|prompt)\(|(^|[^.\w])(alert|confirm|prompt)\(\s*["'`]/m.test(readFileSync(new URL(name, dir), "utf8")));
  assert.deepEqual(offenders, []);
});

test("the alert host is mounted once in the app shell", () => {
  const shell = readFileSync(new URL("./AppShell.svelte", import.meta.url), "utf8");
  assert.equal((shell.match(/<Alert \/>/g) ?? []).length, 1);
});
