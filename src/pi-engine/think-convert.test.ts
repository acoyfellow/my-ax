import assert from "node:assert/strict";
import { test } from "node:test";
import { PiTranscript } from "../ui/pi-transcript";
import { thinkMessagesToPiEntries, transcriptRowsToPiEntries } from "./think-convert";

test("a think conversation converts to pi entries that render in the same order", () => {
  const entries = thinkMessagesToPiEntries([
    { role: "user", parts: [{ type: "text", text: "list files" }], createdAt: "2026-11-01T10:00:00Z" },
    { role: "assistant", parts: [
      { type: "reasoning", text: "check the folder" },
      { type: "tool-exec", toolCallId: "c1", input: { command: "ls" }, output: "a.txt", state: "output-available" },
      { type: "text", text: "one file" },
    ], createdAt: "2026-11-01T10:00:05Z" },
  ]);
  assert.deepEqual(entries.map((entry) => entry.kind), ["pi.user", "pi.assistant", "pi.tool-result"]);
  const transcript = new PiTranscript();
  transcript.applySnapshot({ busy: false, model: "", entries: entries.map((entry, index) => ({ id: index + 1, kind: entry.kind, model: entry.model as never })), partial: null, tools: [], queued: 0 });
  const [user, assistant] = transcript.messages();
  assert.equal(user.content, "list files");
  assert.deepEqual(assistant.parts.map((part) => part.kind === "tool" ? `tool:${part.tool.name}:${part.tool.state}:${part.tool.result}` : `${part.kind}:${part.text}`), ["thinking:check the folder", "tool:exec:done:a.txt", "text:one file"]);
});

test("a tool call with no recorded result converts as an error, never as running", () => {
  const entries = thinkMessagesToPiEntries([{ role: "assistant", parts: [{ type: "tool-exec", toolCallId: "c9", input: {} }] }]);
  const result = entries.find((entry) => entry.kind === "pi.tool-result")?.model?.[0] as { isError?: boolean };
  assert.equal(result.isError, true);
});

test("system messages and empty turns are dropped", () => {
  assert.deepEqual(thinkMessagesToPiEntries([{ role: "system", parts: [{ type: "text", text: "x" }] }, { role: "assistant", parts: [] }, { role: "user", parts: [{ type: "text", text: "  " }] }]), []);
});

test("every new conversation row names its engine so the D1 default of think is never used", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = new URL("../", import.meta.url).pathname;
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== "ui") walk(path); continue; }
      if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name) || name === "agent.ts") continue;
      for (const match of readFileSync(path, "utf8").matchAll(/INSERT INTO sessions \(([^)]*)\)/g)) {
        if (!match[1].includes("engine")) offenders.push(`${path.replace(root, "")}: ${match[0]}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});

test("the full D1 transcript converts with tool rows folded into the assistant turn that ran them", () => {
  const entries = transcriptRowsToPiEntries([
    { ts: "2026-06-10T07:25:29Z", role: "user", tool: null, is_error: 0, content: "open the repo", meta_json: null },
    { ts: "2026-06-10T07:25:40Z", role: "tool", tool: "browser_open", is_error: 0, content: "{\"title\":\"repo\"}", meta_json: JSON.stringify({ toolCallId: "t1", args: { url: "https://x" } }) },
    { ts: "2026-06-10T07:25:50Z", role: "assistant", tool: null, is_error: 0, content: "It is a runtime.", meta_json: JSON.stringify({ reasoning: "read the page" }) },
    { ts: "2026-06-10T07:26:00Z", role: "user", tool: null, is_error: 0, content: "thanks", meta_json: null },
  ]);
  assert.deepEqual(entries.map((entry) => entry.kind), ["pi.user", "pi.assistant", "pi.tool-result", "pi.user"]);
  const assistant = entries[1].model?.[0] as { content: Array<{ type: string }> };
  assert.deepEqual(assistant.content.map((block) => block.type), ["toolCall", "thinking", "text"]);
});
