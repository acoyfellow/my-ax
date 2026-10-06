import assert from "node:assert/strict";
import { test } from "node:test";
import { anthropicGatewayBaseUrl, gatewayRequestHeaders, PI_ENGINE_MODEL_CHOICES } from "./gateway-models";

test("gateway base url switches the openai route to the anthropic route", () => {
  assert.equal(anthropicGatewayBaseUrl("https://gw.example/v1/openai"), "https://gw.example/v1/anthropic");
  assert.equal(anthropicGatewayBaseUrl("https://gw.example/anthropic/"), "https://gw.example/anthropic");
});

test("an access-token gateway also gets an authorization header so the Anthropic SDK sends no api key", () => {
  assert.deepEqual(gatewayRequestHeaders({ "cf-access-token": "t" }), { "cf-access-token": "t", authorization: "Bearer t" });
  assert.deepEqual(gatewayRequestHeaders({ authorization: "Bearer x" }), { authorization: "Bearer x" });
});

test("Opus 5.5 is the first model choice", () => {
  assert.equal(PI_ENGINE_MODEL_CHOICES[0].id, "claude-opus-5-5");
});

test("a refused Opus 5.5 reply is retried on the next model in the chain", async () => {
  const { withRefusalFallback } = await import("./gateway-models");
  const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai/utils/event-stream");
  const calls: string[] = [];
  const fakeModels = [{ id: "claude-opus-5-5" }, { id: "claude-opus-5" }];
  const provider = {
    id: "fake",
    name: "fake",
    auth: {},
    getModels: () => fakeModels,
    stream: () => { throw new Error("unused"); },
    streamSimple: (model: { id: string }) => {
      calls.push(model.id);
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        if (model.id === "claude-opus-5-5") {
          stream.push({ type: "error", reason: "error", error: { role: "assistant", content: [], stopReason: "error", errorMessage: "blocked under Anthropic's Usage Policy" } } as never);
        } else {
          stream.push({ type: "done", reason: "stop", message: { role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop" } } as never);
        }
        stream.end();
      });
      return stream;
    },
  };
  const wrapped = withRefusalFallback(provider as never);
  const events: string[] = [];
  for await (const event of wrapped.streamSimple(fakeModels[0] as never, { messages: [] } as never)) events.push(event.type);
  assert.deepEqual(calls, ["claude-opus-5-5", "claude-opus-5"]);
  assert.deepEqual(events, ["done"]);
});
