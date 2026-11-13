import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("./AppShell.svelte", import.meta.url), "utf8");
const popOut = readFileSync(new URL("./AppPopOut.svelte", import.meta.url), "utf8");

test("the app bar keeps the picture-in-picture pop-out button", () => {
  assert.match(shell, /<AppPopOut \/>/);
  assert.match(popOut, /data-app-popout/);
  assert.match(popOut, /documentPip\(window\)/);
});

test("the app bar does not show the signed-in email", () => {
  assert.doesNotMatch(shell, /identity-email-anchor/);
  assert.doesNotMatch(shell, /Signed in as/);
});

test("inside the pop-out the button turns into a return control and the docked sidebar width is reset", () => {
  assert.match(popOut, /popped \? "Return my ax to the tab"/);
  assert.match(popOut, /"--sessions-dock-width"/);
  assert.match(popOut, /dataset\.pip = "1"/);
});

test("the sidebar has no Home tile; pins carry a size instead", () => {
  const sessions = readFileSync(new URL("./Sessions.svelte", import.meta.url), "utf8");
  assert.doesNotMatch(sessions, /session-home|HOME_TITLE|\/api\/root/);
  assert.match(sessions, /data-size=\{pinnedGroup \? pinSizeOf\(row\.pin_size\) : undefined\}/);
  assert.match(sessions, /\/pin-size`/);
});

test("Today and Older groups collapse, remember it, and open while searching", () => {
  const sessions = readFileSync(new URL("./Sessions.svelte", import.meta.url), "utf8");
  assert.match(sessions, /collapsed = !searchQuery && collapsedGroups\.includes\(bucket\.group\)/);
  assert.match(sessions, /aria-expanded=\{!collapsed\}/);
  assert.match(sessions, /localStorage\.setItem\(COLLAPSED_GROUPS_KEY/);
});
