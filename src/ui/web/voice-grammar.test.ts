import assert from "node:assert/strict";
import { test } from "node:test";
import { isConfirm, parseVoice } from "./voice-grammar";

test("no wake word means nothing happens", () => {
  assert.deepEqual(parseVoice("approve card 3"), { ok: false, reason: "no-wake" });
  assert.deepEqual(parseVoice(""), { ok: false, reason: "no-wake" });
  assert.deepEqual(parseVoice("max approve card 3"), { ok: false, reason: "no-wake" });
});

test("wake word alone is empty", () => {
  assert.deepEqual(parseVoice("AX"), { ok: false, reason: "empty" });
  assert.deepEqual(parseVoice("  ax,  "), { ok: false, reason: "empty" });
});

test("wake word variants and punctuation are accepted", () => {
  for (const t of ["AX, open desk", "ax open desk", "Ax. Open desk.", "hey ax open the desk", "a x open desk"]) {
    const r = parseVoice(t);
    assert.equal(r.ok, true, t);
    if (r.ok) assert.deepEqual(r.command, { kind: "open", target: "desk" }, t);
  }
});

test("open targets", () => {
  for (const target of ["root", "attention", "settings"] as const) {
    const r = parseVoice(`AX, open ${target}`);
    assert.ok(r.ok && r.command.kind === "open" && r.command.target === target);
    assert.ok(r.ok && r.needsConfirm === false);
  }
  assert.deepEqual(parseVoice("AX open the fridge"), { ok: false, reason: "unknown" });
});

test("approve and dismiss take a card number as digits or words and need confirm", () => {
  const a = parseVoice("AX, approve card 3");
  assert.deepEqual(a, { ok: true, command: { kind: "approve", card: 3 }, needsConfirm: true });
  const b = parseVoice("ax approve card three");
  assert.deepEqual(b, { ok: true, command: { kind: "approve", card: 3 }, needsConfirm: true });
  const c = parseVoice("AX dismiss card 12");
  assert.deepEqual(c, { ok: true, command: { kind: "dismiss", card: 12 }, needsConfirm: true });
  const d = parseVoice("AX dismiss number two");
  assert.deepEqual(d, { ok: true, command: { kind: "dismiss", card: 2 }, needsConfirm: true });
});

test("card numbers must be positive whole numbers up to 99", () => {
  assert.deepEqual(parseVoice("AX approve card 0"), { ok: false, reason: "unknown" });
  assert.deepEqual(parseVoice("AX approve card 100"), { ok: false, reason: "unknown" });
  assert.deepEqual(parseVoice("AX approve card"), { ok: false, reason: "unknown" });
  assert.deepEqual(parseVoice("AX approve card 2.5"), { ok: false, reason: "unknown" });
});

test("stop needs no confirm", () => {
  assert.deepEqual(parseVoice("AX stop"), { ok: true, command: { kind: "stop" }, needsConfirm: false });
  assert.deepEqual(parseVoice("ax, stop."), { ok: true, command: { kind: "stop" }, needsConfirm: false });
});

test("ask keeps the rest of the text verbatim after trimming and needs no confirm", () => {
  assert.deepEqual(parseVoice("AX, ask what broke in CI today?"), { ok: true, command: { kind: "ask", text: "what broke in CI today?" }, needsConfirm: false });
  assert.deepEqual(parseVoice("AX ask"), { ok: false, reason: "unknown" });
});

test("ask text is capped at 500 characters", () => {
  const long = "x".repeat(800);
  const r = parseVoice(`AX ask ${long}`);
  assert.ok(r.ok && r.command.kind === "ask" && r.command.text.length === 500);
});

test("unknown verbs are unknown", () => {
  assert.deepEqual(parseVoice("AX delete everything"), { ok: false, reason: "unknown" });
  assert.deepEqual(parseVoice("AX approve"), { ok: false, reason: "unknown" });
});

test("confirm words", () => {
  for (const t of ["confirm", "Confirm.", "AX confirm", "yes confirm", "  CONFIRM  "]) assert.equal(isConfirm(t), true, t);
  for (const t of ["", "yes", "no", "cancel", "confirmation please", "don't confirm"]) assert.equal(isConfirm(t), false, t);
});
