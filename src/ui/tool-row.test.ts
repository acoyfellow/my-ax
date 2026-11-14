import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { codeHeadline, formatToolResult, toolArgFields, toolArgSummary, toolRowState, unescapeIfEscaped, TOOL_ROW_STATUS_LABEL } from "./tool-row";

test("work_code shows its first meaningful line, never a brace or an escaped newline", () => {
  const summary = toolArgSummary("work_code", { code: "async () => {\\n  const r = await workspace.exec({ command: \"ls\" });\\n  return r;\\n}" });
  assert.equal(summary, "const r = await workspace.exec({ command: \"ls\" });");
  assert.doesNotMatch(summary, /\\n|^\{/);
});

test("work_code with a reusable marker shows the reusable tool name", () => {
  assert.equal(codeHeadline("async () => {\n  // reusable: list-open-mrs\n  return 1;\n}"), "list-open-mrs");
  assert.equal(toolArgSummary("work_code", { code: "x", reusableToolName: "deploy-check" }), "deploy-check");
});

test("each tool kind shows its most useful argument", () => {
  assert.equal(toolArgSummary("work_search", { query: "failing test", limit: 5 }), "failing test");
  assert.equal(toolArgSummary("read_file", { path: "/a/b.ts" }), "/a/b.ts");
  assert.equal(toolArgSummary("browser_open", { url: "https://x.dev" }), "https://x.dev");
  assert.equal(toolArgSummary("some_new_tool", { flag: true, url: "https://y.dev" }), "https://y.dev");
  assert.equal(toolArgSummary("exec", { command: "echo a\nls" }), "echo a ls");
  assert.equal(toolArgSummary("noop", {}), "");
});

test("long summaries are clipped with an ellipsis", () => {
  const summary = toolArgSummary("work_search", { query: "q".repeat(200) });
  assert.ok(summary.length <= 72);
  assert.ok(summary.endsWith("…"));
});

test("one status vocabulary for every row", () => {
  assert.deepEqual(["pending", "done", "error"].map(toolRowState), ["running", "ok", "error"]);
  assert.deepEqual(TOOL_ROW_STATUS_LABEL, { running: "Running", ok: "Done", error: "Failed" });
});

test("expanded args show real line breaks for code", () => {
  const [field] = toolArgFields({ code: "a()\\nb()" });
  assert.equal(field!.value, "a()\nb()");
  assert.equal(field!.block, true);
  assert.equal(unescapeIfEscaped("real\nbreak \\n kept"), "real\nbreak \\n kept");
});

test("a JSON result with a multiline string shows the string with real breaks", () => {
  const text = formatToolResult(JSON.stringify({ ok: true, result: "#1 a\n#2 b" }));
  assert.match(text, /result:\n#1 a\n#2 b/);
  assert.doesNotMatch(text, /\\n/);
});

const chat = readFileSync(new URL("./Chat.svelte", import.meta.url), "utf8");

test("thinking and tools render through the same step row", () => {
  assert.equal((chat.match(/\{@render stepRow\(/g) ?? []).length >= 3, true, "thinking, reasoning fallback and tool calls use stepRow");
  assert.doesNotMatch(chat, /class="msg-reasoning"/);
  assert.doesNotMatch(chat, /briefArgs\(/);
  assert.doesNotMatch(chat, /…running/);
});

test("a running turn shows one live status line, not dots plus two timers", () => {
  assert.match(chat, /\{#if \(turnIsLive && taskElapsedText\) \|\| thinkingVisible\}\s*<div class="msg msg-duration msg-duration--running" data-task-timer/);
  assert.equal((chat.match(/data-task-timer/g) ?? []).length, 1);
  assert.match(chat, /showsTurnDuration\(m, mIdx\)/);
  assert.match(chat, /return !\(turnIsLive && index > lastUserIndex\)/);
});
