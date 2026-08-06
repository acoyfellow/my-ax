import assert from "node:assert/strict";
import test from "node:test";
import { parseVoiceThinkAgentName, resolveVoiceThinkConfig } from "./voice-think-config";
import { MAX_VOICE_TURN_BUFFER_CHARS, VoiceTurnReplyBuffer, consumeVoiceTurnStream, createVoiceTurnStream } from "./voice-turn-stream";

const seeded = { identity: { email: "seeded@example.com", sub: "seeded-sub" }, sessionId: "seeded-session" };

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("MyAgent.runVoiceTurnStream emits incremental text deltas before chat completes", async () => {
  const releaseChat = deferred<void>();
  let chatFinished = false;
  const stream = createVoiceTurnStream("hello", async (transcript, callbacks) => {
    assert.equal(transcript, "hello");
    await callbacks.onEvent(JSON.stringify({ type: "text-delta", delta: "Hel" }));
    await releaseChat.promise;
    await callbacks.onEvent(JSON.stringify({ type: "text-delta", delta: "lo" }));
    await callbacks.onDone();
    chatFinished = true;
  });

  const reader = stream.getReader();
  assert.deepEqual(await reader.read(), { value: "Hel", done: false });
  assert.equal(chatFinished, false);
  releaseChat.resolve();
  assert.deepEqual(await reader.read(), { value: "lo", done: false });
  assert.deepEqual(await reader.read(), { value: undefined, done: true });
});

test("runVoiceTurn compatibility keeps partial text when a later stream error occurs", async () => {
  const stream = createVoiceTurnStream("hello", async (_transcript, callbacks) => {
    await callbacks.onEvent(JSON.stringify({ type: "text-delta", delta: "partial" }));
    await callbacks.onError("late failure");
  });
  let reply = "";

  for await (const chunk of stream) reply += chunk;

  assert.equal(reply, "partial");
});

test("runVoiceTurn compatibility rejects an error before any text", async () => {
  const stream = createVoiceTurnStream("hello", async (_transcript, callbacks) => {
    await callbacks.onError("early failure");
  });

  await assert.rejects(async () => {
    for await (const _chunk of stream) {}
  }, /early failure/);
});

test("stopping local voice leaves the canonical turn running and preserves one transcript reply", async () => {
  const releaseCanonicalTurn = deferred<void>();
  const canonicalTurnFinished = deferred<void>();
  const transcript = ["user: hello"];
  let canonicalTurnCalls = 0;
  const stream = createVoiceTurnStream("hello", async (_transcript, callbacks) => {
    canonicalTurnCalls += 1;
    await releaseCanonicalTurn.promise;
    transcript.push("assistant: canonical reply");
    await callbacks.onEvent(JSON.stringify({ type: "text-delta", delta: "canonical reply" }));
    await callbacks.onDone();
    canonicalTurnFinished.resolve();
  });
  const reader = stream.getReader();

  await reader.cancel("local voice stopped");
  releaseCanonicalTurn.resolve();
  await canonicalTurnFinished.promise;

  assert.equal(canonicalTurnCalls, 1);
  assert.deepEqual(transcript, ["user: hello", "assistant: canonical reply"]);
  assert.deepEqual(await reader.read(), { value: undefined, done: true });
});

test("VoiceThinkAgent exposes the first streamed delta before the reply completes", async () => {
  let controller!: ReadableStreamDefaultController<string>;
  const response = new ReadableStream<string>({ start(value) { controller = value; } });
  const replyBuffer = new VoiceTurnReplyBuffer();
  let streamCompleted = false;
  const consumed = consumeVoiceTurnStream(response, new AbortController().signal, (delta) => replyBuffer.push(delta))
    .finally(() => { streamCompleted = true; });

  controller.enqueue("Hel");
  assert.equal(await replyBuffer.waitForChunk(100), true);
  assert.deepEqual(replyBuffer.drain(), ["Hel"]);
  assert.equal(streamCompleted, false);

  controller.enqueue("lo");
  controller.close();
  const result = await consumed;
  replyBuffer.complete();

  assert.deepEqual(result, { receivedText: true });
  assert.deepEqual(replyBuffer.drain(), ["lo"]);
  assert.deepEqual(replyBuffer.finish(result?.receivedText ?? false), []);
});

test("VoiceThinkAgent interruption cancels the source and suppresses buffered stale output", async () => {
  const firstDelta = deferred<void>();
  const cancelled = deferred<unknown>();
  const abortController = new AbortController();
  const response = new ReadableStream<string>({
    start(controller) {
      controller.enqueue("stale");
    },
    cancel(reason) {
      cancelled.resolve(reason);
    },
  });
  const replyBuffer = new VoiceTurnReplyBuffer();
  const consumed = consumeVoiceTurnStream(response, abortController.signal, (delta) => {
    replyBuffer.push(delta);
    firstDelta.resolve();
  });

  await firstDelta.promise;
  abortController.abort();
  assert.equal(await cancelled.promise, "voice turn interrupted");
  assert.equal(await consumed, null);
  replyBuffer.interrupt();
  assert.deepEqual(replyBuffer.drain(), []);
});

test("voice turn bounds queued and pending unread text without cancelling canonical work", async () => {
  const completed = deferred<void>();
  let emitted = 0;
  const stream = createVoiceTurnStream("hello", async (_transcript, callbacks) => {
    for (let index = 0; index < 1_000; index += 1) {
      emitted += 1;
      await callbacks.onEvent(JSON.stringify({ type: "text-delta", delta: `chunk-${String(index).padStart(4, "0")}-${"x".repeat(64)}` }));
    }
    await callbacks.onDone();
    completed.resolve();
  });

  await completed.promise;
  const reader = stream.getReader();
  const chunks: string[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  const received = chunks.join("");

  assert.equal(emitted, 1_000);
  assert.ok(chunks.length >= 2);
  assert.ok(received.length <= MAX_VOICE_TURN_BUFFER_CHARS);
  assert.match(received, /full response in the chat/);
  assert.match(received, /chunk-0999/);
});

test("voice turn keeps the overflow notice and latest suffix after an initial large unread chunk", async () => {
  const completed = deferred<void>();
  const stream = createVoiceTurnStream("hello", async (_transcript, callbacks) => {
    await callbacks.onEvent(JSON.stringify({ type: "text-delta", delta: `initial-${"x".repeat(MAX_VOICE_TURN_BUFFER_CHARS)}` }));
    await callbacks.onEvent(JSON.stringify({ type: "text-delta", delta: " latest-suffix" }));
    await callbacks.onDone();
    completed.resolve();
  });

  await completed.promise;
  const reader = stream.getReader();
  let received = "";
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    received += next.value;
  }

  assert.ok(received.length <= MAX_VOICE_TURN_BUFFER_CHARS);
  assert.match(received, /full response in the chat/);
  assert.match(received, /latest-suffix/);
});

test("voice reply buffering remains bounded and keeps the most recent speech when TTS is slower", () => {
  const buffer = new VoiceTurnReplyBuffer();
  for (let index = 0; index < 1_000; index += 1) buffer.push(`chunk-${String(index).padStart(4, "0")}-${"x".repeat(64)}`);

  const [speech] = buffer.drain();

  assert.ok(speech.length <= MAX_VOICE_TURN_BUFFER_CHARS);
  assert.match(speech, /full response in the chat/);
  assert.match(speech, /chunk-0999/);
});

test("voice think config keeps explicitly seeded identity/session", () => {
  assert.deepEqual(resolveVoiceThinkConfig(seeded, "owner@example.com:session-1"), seeded);
});

test("voice think config recovers owner/session from direct actor name", () => {
  assert.deepEqual(parseVoiceThinkAgentName("Owner@Example.com:session-1"), {
    identity: { email: "owner@example.com", sub: "owner@example.com" },
    sessionId: "session-1",
  });
  assert.deepEqual(resolveVoiceThinkConfig({}, "Owner@Example.com:session-1"), {
    identity: { email: "owner@example.com", sub: "owner@example.com" },
    sessionId: "session-1",
  });
});

test("voice think config fails closed when neither state nor actor name link a session", () => {
  assert.equal(parseVoiceThinkAgentName("session-1"), null);
  assert.equal(parseVoiceThinkAgentName("owner@example.com:"), null);
  assert.equal(parseVoiceThinkAgentName(":session-1"), null);
  assert.deepEqual(resolveVoiceThinkConfig({}, "session-1"), {});
});

// Regression: the voice route must route with the RAW voiceName. Percent-
// encoding it sent the socket to a different (unseeded) DO whose this.name was
// "email%3Asession" — no literal ':' — so the name-parse fallback returned {}
// and every turn answered "Voice session is not linked to a conversation yet."
test("voice actor name must round-trip through the router without percent-encoding", () => {
  const voiceName = "owner@example.com:11111111-2222-4333-8444-555555555555";

  // The OLD broken behavior: encodeURIComponent(voiceName) as the path segment.
  const encoded = encodeURIComponent(voiceName);
  assert.equal(parseVoiceThinkAgentName(encoded), null, "percent-encoded name must NOT parse (this was the bug)");
  assert.deepEqual(resolveVoiceThinkConfig({}, encoded), {}, "percent-encoded name yields an unlinked config");

  // The FIX: the raw voiceName travels through URL.pathname unchanged, so the
  // routed DO name equals the seeded voiceName and the fallback also parses.
  const routedSegment = new URL(`https://h/agents/voice-think-agent/${voiceName}`)
    .pathname.split("/").filter(Boolean)[2];
  assert.equal(routedSegment, voiceName, "raw voiceName must survive URL.pathname unchanged");
  assert.deepEqual(parseVoiceThinkAgentName(routedSegment), {
    identity: { email: "owner@example.com", sub: "owner@example.com" },
    sessionId: "11111111-2222-4333-8444-555555555555",
  });
});
