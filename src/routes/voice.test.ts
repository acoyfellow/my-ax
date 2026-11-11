import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseVoiceDeskRequest } from "../voice-command";

test("the voice desk route accepts only approve or dismiss with a whole card number", () => {
  assert.deepEqual(parseVoiceDeskRequest({ kind: "approve", card: 3, confirmed: true, heard: "AX approve card 3" }), { action: { kind: "approve", card: 3 }, confirmed: true, heard: "AX approve card 3" });
  assert.equal(parseVoiceDeskRequest({ kind: "delete", card: 3 }), null);
  assert.equal(parseVoiceDeskRequest({ kind: "approve", card: "3" }), null);
  assert.equal(parseVoiceDeskRequest({ kind: "approve", card: 2.5 }), null);
  assert.equal(parseVoiceDeskRequest({ kind: "approve", card: 100 }), null);
  assert.equal(parseVoiceDeskRequest(null), null);
});

test("confirmed must be literally true; anything else is not confirmed", () => {
  assert.equal(parseVoiceDeskRequest({ kind: "dismiss", card: 1, confirmed: "true" })?.confirmed, false);
  assert.equal(parseVoiceDeskRequest({ kind: "dismiss", card: 1 })?.confirmed, false);
});

test("the route plans against the owner's own board and writes through the locked desk writers", () => {
  const source = readFileSync(new URL("./voice.ts", import.meta.url), "utf8");
  assert.ok(source.includes('c.get("identity").email'));
  assert.ok(source.includes("planVoiceDeskAction(board, request.action, request.confirmed)"));
  assert.ok(source.includes("ownerDeskRemove(") && source.includes("ownerDeskUpsert("));
});
