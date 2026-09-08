import assert from "node:assert/strict";
import test from "node:test";
import type { VoiceTransport } from "@cloudflare/voice/client";
import { TappedVoiceTransport } from "./tapped-voice-transport";

type MessageData = string | ArrayBuffer | Blob;

class FakeTransport implements VoiceTransport {
  connected = true;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error?: unknown) => void) | null = null;
  onmessage: ((data: MessageData) => void) | null = null;
  sentJSON: Record<string, unknown>[] = [];
  sentBinary: ArrayBuffer[] = [];
  connectCalls = 0;
  disconnectCalls = 0;

  sendJSON(data: Record<string, unknown>): void {
    this.sentJSON.push(data);
  }

  sendBinary(data: ArrayBuffer): void {
    this.sentBinary.push(data);
  }

  connect(): void {
    this.connectCalls++;
  }

  disconnect(): void {
    this.disconnectCalls++;
  }

  receive(data: MessageData): void {
    this.onmessage?.(data);
  }
}

function pcm16Frame(value: number, samples = 1_600): ArrayBuffer {
  const frame = new Int16Array(samples);
  frame.fill(value);
  return frame.buffer as ArrayBuffer;
}

function activeTransport(): { inner: FakeTransport; transport: TappedVoiceTransport } {
  const inner = new FakeTransport();
  const transport = new TappedVoiceTransport({ agent: "voice-think-agent" }, inner);
  transport.sendJSON({ type: "start_call" });
  inner.receive(JSON.stringify({ type: "audio_config", format: "pcm16", sampleRate: 16_000 }));
  return { inner, transport };
}

test("tapped transport delegates outbound traffic and connection control", () => {
  const { inner, transport } = activeTransport();
  const json = { type: "custom", value: "unchanged" };
  const binary = pcm16Frame(400);

  transport.sendJSON(json);
  transport.sendBinary(binary);
  transport.connect();
  transport.disconnect();

  assert.equal(inner.sentJSON[1], json);
  assert.equal(inner.sentBinary[0], binary);
  assert.equal(inner.connectCalls, 1);
  assert.equal(inner.disconnectCalls, 1);
});

test("tapped transport forwards messages unchanged and meters agent PCM output", async () => {
  const { inner, transport } = activeTransport();
  const forwarded: MessageData[] = [];
  const audio = pcm16Frame(16_000);
  transport.onmessage = (data) => forwarded.push(data);

  const configuration = JSON.stringify({ type: "audio_config", format: "pcm16", sampleRate: 16_000 });
  inner.receive(configuration);
  inner.receive(audio);
  await transport.waitForOutputMeasurements();

  assert.deepEqual(forwarded, [configuration, audio]);
  assert.ok(transport.getOutputLevel() > 0.45);
});

test("a muted reply keeps recognition fed with silence and resumes real input", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { inner, transport } = activeTransport();
  transport.setInputSuppressed(true);
  transport.setInputSuppressed(true);
  t.mock.timers.tick(12_000);
  assert.equal(inner.sentBinary.length, 120);
  for (const frame of inner.sentBinary) {
    assert.equal(frame.byteLength, 3200);
    assert.ok(new Uint8Array(frame).every((sample) => sample === 0));
  }
  transport.setInputSuppressed(false);
  t.mock.timers.tick(1000);
  assert.equal(inner.sentBinary.length, 120);
  const secondTurn = pcm16Frame(12_000);
  transport.sendBinary(secondTurn);
  assert.equal(inner.sentBinary.at(-1), secondTurn);
  transport.disconnect();
});

test("suppression never forwards microphone content and stops on end or disconnect", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  for (const end of ["end_call", "disconnect"]) {
    const { inner, transport } = activeTransport();
    transport.setInputSuppressed(true);
    transport.sendBinary(pcm16Frame(25_000));
    assert.ok(new Uint8Array(inner.sentBinary[0]!).every((sample) => sample === 0));
    if (end === "end_call") transport.sendJSON({ type: "end_call" });
    else transport.disconnect();
    const count = inner.sentBinary.length;
    t.mock.timers.tick(2000);
    assert.equal(inner.sentBinary.length, count);
  }
});

test("silence is not sent on a disconnected or inactive transport", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const inner = new FakeTransport();
  const transport = new TappedVoiceTransport({ agent: "voice-think-agent" }, inner);
  transport.setInputSuppressed(true);
  t.mock.timers.tick(1000);
  assert.equal(inner.sentBinary.length, 0);
  transport.sendJSON({ type: "start_call" });
  inner.connected = false;
  t.mock.timers.tick(1000);
  assert.equal(inner.sentBinary.length, 0);
  transport.disconnect();
});

test("tapped transport reports silence as near-zero output", async () => {
  const { inner, transport } = activeTransport();
  inner.receive(pcm16Frame(0));
  await transport.waitForOutputMeasurements();

  assert.ok(transport.getOutputLevel() < 0.001);
});
