import assert from "node:assert/strict";
import test from "node:test";
import { CONVO_STYLES, CONVO_STYLE_SPECS, convoStyleOf, convoStyleSection, parseConvoStyle, readConvoStyle } from "./convo-style";
import { SESSION_SQL } from "./domain/Session/Session.store";
import { SESSION_DETAILS } from "./domain/Session/UpdateSessionDetails.command";
import { VOICE_ACK_THRESHOLD_MS, WORK_ACK } from "./voice-narration";

test("standard keeps today's voice behaviour", () => {
  assert.deepEqual(CONVO_STYLE_SPECS.standard.voice, { ackMs: VOICE_ACK_THRESHOLD_MS, checkinMs: 20000, ack: WORK_ACK });
});

test("every style has a label, a summary and voice timings", () => {
  for (const id of CONVO_STYLES) {
    const spec = CONVO_STYLE_SPECS[id];
    assert.equal(spec.id, id);
    assert.ok(spec.label.length > 0);
    assert.ok(spec.summary.length > 0);
    assert.ok(spec.voice.ackMs > 0 && spec.voice.ackMs <= 1000, `${id} ack must start within a second`);
    assert.ok(spec.voice.checkinMs >= 5000);
    assert.ok(spec.voice.ack.length > 0);
  }
});

test("standard adds nothing to the prompt; every other style adds a section with the proof rule", () => {
  assert.equal(convoStyleSection("standard"), undefined);
  for (const id of CONVO_STYLES.filter((s) => s !== "standard")) {
    const section = convoStyleSection(id);
    assert.ok(section?.includes(`Conversation style: ${CONVO_STYLE_SPECS[id].label}`));
    assert.match(section ?? "", /only when a tool result in this turn proves it/);
  }
});

test("parsing rejects unknown styles and defaults to standard", () => {
  assert.equal(parseConvoStyle("narrated"), "narrated");
  assert.equal(parseConvoStyle("loud"), null);
  assert.equal(parseConvoStyle(3), null);
  assert.equal(convoStyleOf(undefined), "standard");
  assert.equal(convoStyleOf("fleet"), "fleet");
});

test("readConvoStyle reads the owner's row and falls back to standard", async () => {
  const calls: unknown[][] = [];
  const db = (value: unknown) => ({
    prepare: (sql: string) => ({
      bind: (...binds: unknown[]) => {
        calls.push([sql, ...binds]);
        return { first: async <T,>() => (value === "throw" ? Promise.reject(new Error("db")) : (value as T | null)) };
      },
    }),
  });
  assert.equal(await readConvoStyle(db({ convo_style: "instant" }), "s1", "Jordan@Example.com"), "instant");
  assert.deepEqual(calls[0], ["SELECT convo_style FROM sessions WHERE id = ? AND owner_email = ?", "s1", "jordan@example.com"]);
  assert.equal(await readConvoStyle(db(null), "s1", "a@b.c"), "standard");
  assert.equal(await readConvoStyle(db({ convo_style: "bogus" }), "s1", "a@b.c"), "standard");
  assert.equal(await readConvoStyle(db("throw"), "s1", "a@b.c"), "standard");
});

test("the style write goes through the Session domain store", () => {
  assert.ok((SESSION_DETAILS as readonly string[]).includes("style"));
  assert.equal(SESSION_SQL.S17_STYLE.kind, "style");
  assert.match(SESSION_SQL.S17_STYLE.sql, /^UPDATE sessions SET convo_style = \? WHERE id = \? AND owner_email = \?$/);
});

test("each style has a mid-turn rule and a plain hint", () => {
  const expected = { standard: "queue", narrated: "steer", instant: "ask", background: "steer", fleet: "steer", draft: "interrupt" };
  for (const id of CONVO_STYLES) {
    assert.equal(CONVO_STYLE_SPECS[id].midTurn, expected[id], id);
    assert.ok(CONVO_STYLE_SPECS[id].midTurnHint.length > 10, id);
  }
});

test("every style has a short while-working tag, and the tags tell the four mid-turn rules apart", () => {
  const tagByRule = new Map<string, string>();
  for (const id of CONVO_STYLES) {
    const spec = CONVO_STYLE_SPECS[id];
    assert.ok(spec.whileWorking.length > 0 && spec.whileWorking.length <= 16, id);
    assert.ok(spec.summary.length <= 45, `${id} summary is short`);
    const seen = tagByRule.get(spec.midTurn);
    if (seen) assert.equal(seen, spec.whileWorking, `${id} shares its rule's tag`);
    tagByRule.set(spec.midTurn, spec.whileWorking);
  }
  assert.equal(new Set(tagByRule.values()).size, tagByRule.size);
});
