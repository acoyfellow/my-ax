import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, type Message } from "@earendil-works/pi-ai";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { buildCompactionInstructions, capVerbatim, extractPreservedBlock, FIRST_MESSAGE_CAP, findFirstUserMessage, guardSummary, compactionQualityExtension, PRESERVATION_INSTRUCTIONS, TRUNCATION_MARKER } from "./compaction-guard";

const user = (text: string): Message => ({ role: "user", content: text, timestamp: 0 });
const userBlocks = (text: string): Message => ({ role: "user", content: [{ type: "text", text }], timestamp: 0 });

test("capVerbatim keeps short text exactly and caps long text with a marker", () => {
  assert.equal(capVerbatim("exact  wording\n"), "exact  wording\n");
  const long = "x".repeat(FIRST_MESSAGE_CAP + 50);
  assert.equal(capVerbatim(long), `${"x".repeat(FIRST_MESSAGE_CAP)}${TRUNCATION_MARKER}`);
});

test("capVerbatim never splits a surrogate pair", () => {
  const text = `${"a".repeat(FIRST_MESSAGE_CAP - 1)}😀tail`;
  const capped = capVerbatim(text);
  assert.equal(capped, `${"a".repeat(FIRST_MESSAGE_CAP - 1)}${TRUNCATION_MARKER}`);
});

test("findFirstUserMessage returns the first user message from string or block content", () => {
  assert.equal(findFirstUserMessage([user("  Build X  "), user("later")]), "  Build X  ");
  assert.equal(findFirstUserMessage([userBlocks("Build Y")]), "Build Y");
  assert.equal(findFirstUserMessage([]), undefined);
});

test("findFirstUserMessage skips harness summaries and empty messages", () => {
  const summary = user("The conversation history before this point was compacted into the following summary:\n\n<summary>\nstuff\n</summary>");
  assert.equal(findFirstUserMessage([summary, user("real")]), "real");
  assert.equal(findFirstUserMessage([user("   "), user("real")]), "real");
});

test("a prior summary carrying the preserved block keeps the original wording across repeated compactions", () => {
  const first = "Original request: ship it";
  const guarded = guardSummary("## Goal\nship", first);
  const summaryMessage = user(`The conversation history before this point was compacted into the following summary:\n\n<summary>\n${guarded}\n</summary>`);
  assert.equal(findFirstUserMessage([summaryMessage, user("follow up")]), first);
});

test("buildCompactionInstructions covers the three preservation rules, the quoted message, and existing instructions", () => {
  const text = buildCompactionInstructions("Do the thing", "focus on tests");
  assert.ok(text.includes(PRESERVATION_INSTRUCTIONS));
  assert.match(text, /first message/);
  assert.match(text, /goal and every constraint/);
  assert.match(text, /Key decisions/);
  assert.match(text, /file paths, commit hashes/);
  assert.ok(text.includes("Do the thing"));
  assert.ok(text.endsWith("focus on tests"));
  assert.equal(buildCompactionInstructions(undefined).includes("verbatim:"), false);
});

test("guardSummary prepends the first message when missing and is idempotent when present", () => {
  const first = "Please refactor <b>auth</b> & keep $1 \\n literal";
  const guarded = guardSummary("## Goal\nrefactor", first);
  assert.equal(extractPreservedBlock(guarded), first);
  assert.ok(guarded.endsWith("## Goal\nrefactor"));
  assert.equal(guardSummary(guarded, first), guarded);
  assert.equal(guardSummary("plain", undefined), "plain");
});

test("guardSummary replaces a summarizer that altered the quoted block", () => {
  const first = "exact words";
  const altered = guardSummary("body", "paraphrased");
  const fixed = guardSummary(altered, first);
  assert.equal(fixed.includes(first), true);
  assert.equal(extractPreservedBlock(fixed.split("\n\n").slice(0, 1).join("\n\n")), first);
});

test("real harness compaction keeps the exact first user message in the compacted context", async () => {
  const context = BACKGROUND_CONTEXT;
  const faux = fauxProvider();
  const firstMessage = "ORIGINAL REQUEST: migrate the billing service to Postgres 16, never touch /etc, report in French.";
  const summarizerPrompts: string[] = [];
  const reply = (text: string) => () => fauxAssistantMessage(text);
  faux.setResponses([
    reply("ack 1"),
    reply("ack 2"),
    reply("ack 3"),
    (ctx) => {
      const last = (ctx as { messages: Array<{ content: unknown }> }).messages.at(-1)!;
      summarizerPrompts.push(JSON.stringify(last.content));
      return fauxAssistantMessage("## Goal\nmigrate billing\n## Key Decisions\n- use pg16");
    },
    reply("after compaction"),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  registry.install(compactionQualityExtension());
  const settings = { compaction: { enabled: true, keepRecentTokens: 50, reserveTokens: 16_384, backgroundTokens: 32_768 } };
  const harness = await Harness.open(new MemoryStorage(), { models, registry, settings }, context);
  const model = faux.getModel();
  const root = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id } } });
  const filler = "lorem ipsum dolor sit amet ".repeat(40);
  for (const text of [firstMessage, `second ${filler}`, `third ${filler}`]) {
    const submission = await root.submit({ type: "input", content: text }, context);
    assert.equal((await submission.wait(context)).status, "done");
  }
  const taskId = await root.compact(undefined, context);
  await harness.waitForTask(taskId, context);
  const submission = await root.submit({ type: "input", content: "continue" }, context);
  await submission.wait(context);
  const view = await root.context(context);
  const texts = view.messages.flatMap((message) => (message.role === "user" ? [typeof message.content === "string" ? message.content : message.content.map((block) => (block.type === "text" ? block.text : "")).join("")] : []));
  assert.ok(texts.some((text) => text.includes("compacted") && text.includes(firstMessage)));
  assert.equal(extractPreservedBlock(texts.find((text) => text.includes("compacted"))!), firstMessage);
  assert.equal(summarizerPrompts.length, 1);
  assert.ok(summarizerPrompts[0]!.includes("migrate the billing service"));
  await harness.close(context);
});
