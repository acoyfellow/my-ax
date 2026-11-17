import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readTransfer, transferEntries } from "./chat-transfer";

test("export keeps messages and tool results in order with their times, and drops bookkeeping", () => {
  const entries = transferEntries([
    { id: 3, kind: "pi.assistant", model: [{ role: "assistant" }] },
    { id: 1, kind: "pi.system", model: [] },
    { id: 2, kind: "pi.user", model: [{ role: "user" }] },
    { id: 4, kind: "pi.tool-result", model: [{ role: "toolResult" }], data: { diagnostics: [] } },
    { id: 5, kind: "pi.reset" },
  ], { 2: 100, 3: 200 });
  assert.deepEqual(entries.map((entry) => entry.kind), ["pi.user", "pi.assistant", "pi.tool-result"]);
  assert.equal(entries[0].at, 100);
  assert.equal(entries[2].at, undefined);
  assert.deepEqual(entries[2].data, { diagnostics: [] });
});

test("import accepts only a version 1 chat export with message entries", () => {
  const good = readTransfer({ version: 1, id: "abc12345-x", name: "  Hi  ", createdAt: "2026-01-01 00:00:00", pinned: true, entries: [{ kind: "pi.user", model: [] }] });
  assert.equal(good?.name, "Hi");
  assert.equal(good?.pinned, true);
  assert.equal(good?.updatedAt, null);
  assert.equal(readTransfer({ version: 2, id: "x", entries: [] }), null);
  assert.equal(readTransfer({ version: 1, id: "abc12345-x", entries: [{ kind: "pi.reset" }] }), null);
  assert.equal(readTransfer("nope"), null);
});

test("the import route is owner scoped, refuses existing ids and cleans up on failure", () => {
  const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  assert.match(routes, /app\.get\("\/api\/pi\/chats\/:id\/export"[\s\S]{0,400}owner_email = \?/);
  assert.match(routes, /app\.post\("\/api\/pi\/chats\/import"[\s\S]{0,900}code: "EXISTS"/);
  assert.match(routes, /importTransfer\(transfer\.entries\)[\s\S]{0,300}DELETE FROM sessions WHERE id = \? AND owner_email = \?/);
  assert.match(routes, /importTransfer\(transfer\.entries\);\n      \}, IMPORT_TIMEOUT_MS\)/);
  const agent = readFileSync(new URL("./pi-chat-agent.ts", import.meta.url), "utf8");
  assert.match(agent, /if \(existing === entries\.length\) return existing;/);
});
