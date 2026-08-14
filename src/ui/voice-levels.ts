import type { VoiceAudioFormat } from "@cloudflare/voice/client";

export interface AudioLevelEnvelope {
  levels: Float32Array;
  durationMs: number;
  windowDurationMs: number;
}

const OUTPUT_LEVEL_WINDOW_MS = 64;
let decodeContext: AudioContext | null = null;

function getDecodeContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  if (!decodeContext) decodeContext = new AudioContext();
  return decodeContext;
}

function envelopeFromSamples(samples: Float32Array, sampleRate: number): AudioLevelEnvelope {
  const windowSize = Math.max(1, Math.round((sampleRate * OUTPUT_LEVEL_WINDOW_MS) / 1000));
  const levels = new Float32Array(Math.ceil(samples.length / windowSize));
  for (let windowIndex = 0; windowIndex < levels.length; windowIndex++) {
    const start = windowIndex * windowSize;
    const end = Math.min(start + windowSize, samples.length);
    let sum = 0;
    for (let index = start; index < end; index++) sum += samples[index] * samples[index];
    levels[windowIndex] = Math.sqrt(sum / (end - start));
  }
  return {
    levels,
    durationMs: (samples.length / sampleRate) * 1000,
    windowDurationMs: (windowSize / sampleRate) * 1000,
  };
}

function pcm16Envelope(data: ArrayBuffer, sampleRate: number): AudioLevelEnvelope {
  const pcm = new Int16Array(data);
  const samples = new Float32Array(pcm.length);
  for (let index = 0; index < pcm.length; index++) samples[index] = pcm[index] / 32768;
  return envelopeFromSamples(samples, sampleRate);
}

export async function frameLevelEnvelope(
  data: ArrayBuffer,
  format: VoiceAudioFormat | null,
  sampleRate: number,
): Promise<AudioLevelEnvelope> {
  try {
    if (format === "pcm16") return pcm16Envelope(data, sampleRate);
    const context = getDecodeContext();
    if (!context) return { levels: new Float32Array(0), durationMs: 0, windowDurationMs: 0 };
    const decoded = await context.decodeAudioData(data.slice(0));
    return envelopeFromSamples(decoded.getChannelData(0), decoded.sampleRate);
  } catch {
    return { levels: new Float32Array(0), durationMs: 0, windowDurationMs: 0 };
  }
}
