import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const chatSource = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");

describe("outbound message rendering", () => {
  it("does not add template whitespace before user content", () => {
    expect(chatSource).toContain('<div class="msg-body">\n                  {m.content}</div>');
    expect(chatSource).not.toContain('<div class="msg-body">\n                  {m.content}\n                </div>');
  });

  it("preserves intentional leading composer whitespace while rejecting blank messages", () => {
    expect(chatSource).toContain("    const text = composerText;\n    if (!text.trim() && pendingAttachments.length === 0) return;");
  });
});
