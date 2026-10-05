import assert from "node:assert/strict";
import test from "node:test";
import { verifiedFocus, verifiedPrompt, withVerifiedCmuxDelivery } from "./cmux-delivery-verification";

const MESSAGE = "I approve of the suggested plans. Implement them now.";
const noSleep = async () => undefined;

function fakeTerminal(frames: string[]) {
  let index = 0;
  return async () => ({ tail: frames[Math.min(index++, frames.length - 1)] });
}

test("stale echo of the message before the cursor does not count as delivery", async () => {
  const stale = `> ${MESSAGE}\nassistant: done\n`;
  const receipt = await verifiedPrompt(async () => ({ ok: true, mode: "prompt" }), fakeTerminal([stale, stale]), { message: MESSAGE }, { attempts: 3, sleep: noSleep });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.verified, false);
  assert.match((receipt as { reason: string }).reason, /no new content/);
});

test("new content that only quotes the message inside tool metadata is not a fresh user turn", async () => {
  const before = "pi ready\n";
  const after = `${before}tool: cmux_pi_prompt {"message":"${MESSAGE}"}\n`;
  const receipt = await verifiedPrompt(async () => ({ ok: true }), fakeTerminal([before, after]), { message: MESSAGE }, { attempts: 2, sleep: noSleep });
  assert.equal(receipt.ok, false);
  assert.equal(receipt.verified, false);
});

test("lost cursor is unverified rather than trusting a substring match", async () => {
  const receipt = await verifiedPrompt(async () => ({ ok: true }), fakeTerminal(["old screen\n", `> ${MESSAGE}\n`]), { message: MESSAGE }, { attempts: 1, sleep: noSleep });
  assert.equal(receipt.ok, false);
  assert.match((receipt as { reason: string }).reason, /cursor was lost/);
});

test("fresh user turn with the exact message after the cursor is verified", async () => {
  const before = `> ${MESSAGE}\nassistant: earlier\n`;
  const after = `${before}> ${MESSAGE}\nassistant: working\n`;
  const receipt = await verifiedPrompt(async () => ({ ok: true }), fakeTerminal([before, before, after]), { message: MESSAGE }, { attempts: 3, sleep: noSleep });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.verified, true);
  assert.deepEqual((receipt as { cursor: unknown }).cursor, { before: before.length, after: after.length });
});

test("cursor is captured before the prompt is sent", async () => {
  const events: string[] = [];
  const reader = async () => { events.push("read"); return { tail: events.includes("send") ? `x\n> ${MESSAGE}\n` : "x\n" }; };
  await verifiedPrompt(async () => { events.push("send"); return {}; }, reader, { message: MESSAGE }, { attempts: 1, sleep: noSleep });
  assert.deepEqual(events, ["read", "send", "read"]);
});

test("prompt without a tail reader is unverified", async () => {
  const receipt = await verifiedPrompt(async () => ({ ok: true }), undefined, { message: MESSAGE });
  assert.deepEqual(receipt, { ok: false, verified: false, reason: "no cmux tail reader is published, so delivery cannot be verified" });
});

test("focus is unverified unless the frontmost workspace is confirmed", async () => {
  const send = async () => ({ ok: true, selected: "ws-2" });
  assert.equal((await verifiedFocus(send, async () => ({ workspaces: [{ id: "ws-2", selected: true }] }), { workspaceId: "ws-2" })).verified, false);
  assert.equal((await verifiedFocus(send, async () => ({ frontmostWorkspaceId: "ws-1" }), { workspaceId: "ws-2" })).verified, false);
  assert.equal((await verifiedFocus(send, undefined, { workspaceId: "ws-2" })).ok, false);
  const confirmed = await verifiedFocus(send, async () => ({ workspaces: [{ id: "ws-2", frontmost: true }] }), { workspaceId: "ws-2" });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.verified, true);
});

test("provider wrapper replaces raw prompt and focus receipts", async () => {
  const fns = withVerifiedCmuxDelivery({
    cmux_pi_prompt: async () => ({ ok: true, mode: "prompt" }),
    cmux_workspace_focus: async () => ({ ok: true }),
    cmux_surface_tail: async () => ({ tail: "unchanged\n" }),
    cmux_workspace_list: async () => ({ workspaces: [] }),
  }, { attempts: 1, sleep: noSleep });
  assert.equal((await fns.cmux_pi_prompt({ message: MESSAGE }) as { ok: boolean }).ok, false);
  assert.equal((await fns.cmux_workspace_focus({ workspaceId: "ws-1" }) as { ok: boolean }).ok, false);
});
