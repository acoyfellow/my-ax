import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { mcpToolsExtension } from "./mcp-tools";
import { SpanLogContext, type SpanRecord } from "./span-log";

test("a chat turn with a tool call is written as a tree of spans with ids, not content", async () => {
  const context = BACKGROUND_CONTEXT;
  const records: SpanRecord[] = [];
  const telemetry = new SpanLogContext(() => "chat-1", (record) => records.push(record));
  const faux = fauxProvider();
  faux.setResponses([
    () => fauxAssistantMessage(fauxToolCall("mcp__radar__top", { q: "secret-arg" }), { stopReason: "toolUse" }),
    () => fauxAssistantMessage("secret-answer"),
  ]);
  const models = createModels();
  models.setProvider(faux.provider);
  const tool = { name: "radar__top", serverId: "srv-radar", toolName: "top", description: "Top papers", inputSchema: { type: "object", properties: { q: { type: "string" } } } };
  const runner = { list: async () => [tool], call: async () => "secret-result" };
  const registry = createRegistry();
  registry.install(mcpToolsExtension([tool], () => runner));
  const harness = await Harness.open(new MemoryStorage(), { models, registry, telemetry }, context);
  const model = faux.getModel();
  const root = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id } } });
  const submission = await root.submit({ type: "input", content: "secret-question" }, context);
  assert.equal((await submission.wait(context)).status, "done");
  await harness.close(context);

  const names = new Set(records.map((record) => record.name));
  assert.ok(names.has("pi.durable.submit"), [...names].join(","));
  assert.ok(names.has("pi.durable.phase"), [...names].join(","));
  assert.ok(records.every((record) => record.ev === "pi.span" && record.chat === "chat-1" && /^[0-9a-f]{32}$/.test(record.traceId)));
  assert.ok(records.some((record) => Object.values(record.attrs).includes("mcp__radar__top")), JSON.stringify(records.map((record) => record.attrs)));
  const text = JSON.stringify(records);
  for (const secret of ["secret-arg", "secret-answer", "secret-question", "secret-result"]) assert.ok(!text.includes(secret), secret);
});

test("a failing span is recorded as an error and the failure still reaches the caller", async () => {
  const records: SpanRecord[] = [];
  const telemetry = new SpanLogContext(() => { throw new Error("not bound"); }, (record) => records.push(record));
  await assert.rejects(telemetry.startSpan({ name: "outer" }, (span) => span.startSpan({ name: "inner" }, () => { throw new Error("boom"); })), /boom/);
  const [inner, outer] = records;
  assert.equal(inner.name, "inner");
  assert.equal(inner.status, "error");
  assert.equal(inner.error, "boom");
  assert.equal(inner.parentId, outer.spanId);
  assert.equal(inner.traceId, outer.traceId);
  assert.equal(outer.chat, "unbound");
});

test("a sink that throws never breaks the work being traced", async () => {
  const telemetry = new SpanLogContext(() => "chat-1", () => { throw new Error("sink down"); });
  assert.equal(await telemetry.startSpan({ name: "work" }, () => 42), 42);
});
