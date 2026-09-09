import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");

test("outbound message rendering does not add template whitespace", () => {
  assert.ok(chat.includes('<div class="msg-body">{#if m.attachments && m.attachments.length}'));
  assert.ok(chat.includes('{/if}{m.content}</div>'));
});

test("outbound messages retain intentional leading whitespace", () => {
  assert.ok(chat.includes("const text = composerText;\n    if (!text.trim() && pendingAttachments.length === 0) return;"));
  assert.ok(!chat.includes("const text = composerText.trim();"));
});
