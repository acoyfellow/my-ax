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

test("tapped transport reports silence as near-zero output", async () => {
  const { inner, transport } = activeTransport();
  inner.receive(pcm16Frame(0));
  await transport.waitForOutputMeasurements();

  assert.ok(transport.getOutputLevel() < 0.001);
});
