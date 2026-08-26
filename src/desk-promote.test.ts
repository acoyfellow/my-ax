import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { describePromotion, promotionConfirmed, DeskPromoteError } from "./desk-promote";

const board = { id: "a1", title: "Desk Control Board" };
const chart = { id: "b2", title: "Burndown Chart" };

test("promoting onto an empty desk says the desk is empty", () => {
  const preview = describePromotion(chart, null);
  assert.equal(preview.replaces, null);
  assert.match(preview.summary, /empty right now/);
});

test("promoting over an app names the app being taken down", () => {
  const preview = describePromotion(chart, board);
  assert.equal(preview.replaces?.id, "a1");
  assert.match(preview.summary, /Desk Control Board/, "the owner must be told what is being replaced by name");
  assert.match(preview.summary, /one app/, "the one-app rule must be stated, not implied");
});

test("re-promoting the app already on the desk replaces nothing", () => {
  const preview = describePromotion(board, board);
  assert.equal(preview.isNoop, true);
  assert.equal(preview.replaces, null);
});

test("a replacement is refused until the owner acknowledges the app being taken down", () => {
  const preview = describePromotion(chart, board);
  assert.equal(promotionConfirmed(preview, null), false, "a silent swap must not be allowed");
  assert.equal(promotionConfirmed(preview, "wrong-id"), false);
  assert.equal(promotionConfirmed(preview, "a1"), true);
});

test("a first promotion and a no-op need no acknowledgement", () => {
  assert.equal(promotionConfirmed(describePromotion(chart, null), null), true);
  assert.equal(promotionConfirmed(describePromotion(board, board), null), true);
});

test("promote refuses an artifact with no id", () => {
  assert.throws(() => describePromotion({ id: "", title: "x" }, null), DeskPromoteError);
});

test("the Clear button is gone; it wiped the legacy card board, never the app", () => {
  const desk = readFileSync(new URL("./ui/Desk.svelte", import.meta.url), "utf8");
  assert.doesNotMatch(desk, /desk-clear/, "the Clear button must be gone from the desk");
  assert.doesNotMatch(desk, /clearDesk/, "its handler must be gone too, not left dangling");
});

test("the artifacts library can put an artifact on the desk", () => {
  const settings = readFileSync(new URL("./ui/Settings.svelte", import.meta.url), "utf8");
  assert.match(settings, /Put on desk/, "the artifacts list needs a promote control");
  assert.match(settings, /promotion-preview/, "promoting must first ask what it would replace");
  assert.match(settings, /window\.confirm\(summary\)/, "the owner must confirm the named replacement");
  assert.match(settings, /On the desk/, "the artifact already hosted must be marked, not offered again");
});

test("an agent can promote, and must confirm before replacing", () => {
  const tools = readFileSync(new URL("./tools.ts", import.meta.url), "utf8");
  assert.match(tools, /name: "desk_promote_artifact"/);
  assert.match(tools, /DESK_PROMOTE_TOOL,/, "the tool must be registered, not just defined");
  const def = tools.slice(tools.indexOf("DESK_PROMOTE_TOOL: ToolDef"), tools.indexOf("DESK_CLEAR_TOOL: ToolDef"));
  assert.match(def, /needsConfirmation: true/, "an unconfirmed replacement must stop and report");
  assert.match(def, /exactly ONE app/, "the tool description must state the one-app rule");
});

test("the promote route refuses a swap the owner never acknowledged", () => {
  const routes = readFileSync(new URL("./routes/desk.ts", import.meta.url), "utf8");
  const promote = routes.slice(routes.indexOf("export async function ownerDeskPromote("));
  assert.match(promote.slice(0, 700), /promotionConfirmed/, "the server must enforce it, not trust the client");
});
