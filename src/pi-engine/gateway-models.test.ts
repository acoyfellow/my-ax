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

test("a reply refused after it already streamed some text is retried on the next model, and only the retry is shown", async () => {
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
          stream.push({ type: "start", partial: { role: "assistant", content: [] } } as never);
          stream.push({ type: "text_delta", delta: "I should use sandbox exec" } as never);
          stream.push({ type: "error", reason: "error", error: { role: "assistant", content: [{ type: "text", text: "I should use sandbox exec" }], stopReason: "error", errorMessage: "This request triggered restrictions on violative cyber content and was blocked under Anthropic's Usage Policy." } } as never);
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
  assert.equal(events.includes("error"), false);
  assert.equal(events.at(-1), "done");
});

test("the Google route is derived from the OpenAI gateway URL, like the Anthropic one", async () => {
  const { googleGatewayBaseUrl } = await import("./gateway-models");
  assert.equal(googleGatewayBaseUrl("https://agent.example.com/openai"), "https://agent.example.com/google-ai-studio/v1beta");
  assert.equal(googleGatewayBaseUrl("https://gw.example/openai/"), "https://gw.example/google-ai-studio/v1beta");
  assert.equal(googleGatewayBaseUrl("https://gw.example/"), "https://gw.example/google-ai-studio/v1beta");
});

test("Google requests authenticate with cf-access-token only; a Bearer or api key alone gets 401 from the gateway", async () => {
  const { googleGatewayHeaders } = await import("./gateway-models");
  assert.deepEqual(googleGatewayHeaders({ "cf-access-token": "t", "X-Requested-With": "xmlhttprequest" }), { "X-Requested-With": "xmlhttprequest", "cf-access-token": "t" });
  assert.deepEqual(googleGatewayHeaders({ authorization: "Bearer t" }), { "cf-access-token": "t" });
  assert.deepEqual(googleGatewayHeaders({ "CF-Access-Client-Id": "id", "CF-Access-Client-Secret": "s" }), { "CF-Access-Client-Id": "id", "CF-Access-Client-Secret": "s" });
});

test("all four Gemini 4 models are Pi engine choices on their own Google gateway provider, and Settings maps to them", async () => {
  const { PI_GOOGLE_GATEWAY_PROVIDER_ID, resolvePiModelChoice, gatewayModelWindows } = await import("./gateway-models");
  assert.deepEqual(resolvePiModelChoice("gemini-4-neon"), { provider: PI_GOOGLE_GATEWAY_PROVIDER_ID, id: "gemini-4-neon", label: "Gemini 4 Neon" });
  assert.equal(resolvePiModelChoice("gemini-4-hydrogen")?.provider, PI_GOOGLE_GATEWAY_PROVIDER_ID);
  assert.equal(resolvePiModelChoice("gemini-4-argon")?.label, "Gemini 4 Argon");
  assert.equal(resolvePiModelChoice("gemini-4-carbon")?.label, "Gemini 4 Carbon");
  assert.equal(resolvePiModelChoice("gemini-4-krypton"), undefined);
  const windows = gatewayModelWindows().filter((model) => model.provider === PI_GOOGLE_GATEWAY_PROVIDER_ID);
  assert.deepEqual(windows.map((model) => model.id).sort(), ["gemini-4-argon", "gemini-4-carbon", "gemini-4-hydrogen", "gemini-4-neon"]);
  assert.ok(windows.every((model) => model.contextWindow >= 1_000_000));
  const { MODELS } = await import("../models");
  for (const name of ["Neon", "Hydrogen", "Argon", "Carbon"]) assert.equal(MODELS.find((model) => model.id === `gemini-4-${name.toLowerCase()}`)?.label, `Gemini 4 ${name}`);
});

test("installing gateway models registers a Google provider whose requests go to the gateway with cf-access-token and a placeholder key", async () => {
  const { createModels } = await import("@earendil-works/pi-ai/models");
  const { installGoogleGatewayModels, PI_GOOGLE_GATEWAY_PROVIDER_ID } = await import("./gateway-models");
  const models = createModels();
  assert.equal(installGoogleGatewayModels(models as never, { baseURL: "https://gw.example/openai", headers: { "cf-access-token": "t" } }), true);
  const neon = models.getModel(PI_GOOGLE_GATEWAY_PROVIDER_ID, "gemini-4-neon");
  assert.ok(neon);
  assert.equal(neon.baseUrl, "https://gw.example/google-ai-studio/v1beta");
  assert.equal(neon.api, "google-generative-ai");
  const auth = await (models as unknown as { getAuth(model: unknown): Promise<{ auth: { apiKey?: string; headers?: Record<string, string> } }> }).getAuth(neon);
  assert.equal(auth.auth.apiKey, "gateway");
  assert.equal(auth.auth.headers?.["cf-access-token"], "t");
});
