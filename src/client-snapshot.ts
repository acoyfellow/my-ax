export type ClientChannel = "voice" | "text" | "unknown";

export function parseInputChannel(text: string): ClientChannel {
  if (text.startsWith("VOICE_CHANNEL=audio.")) return "voice";
  if (text.startsWith("INPUT_CHANNEL=text.")) return "text";
  return "unknown";
}

export function requireInputChannel(text: string): ClientChannel {
  const channel = parseInputChannel(text);
  if (channel === "unknown") {
    throw new Error("INPUT_CHANNEL_MISSING: prefix VOICE_CHANNEL=audio. or INPUT_CHANNEL=text. is required");
  }
  return channel;
}

export function formatClientSnapshot(fields: Record<string, { value: string; at: string; stale?: boolean }>): string {
  const lines = Object.entries(fields).map(([key, field]) => {
    const mark = field.stale ? " stale" : "";
    return `${key}: ${field.value || "unknown"}${mark} @${field.at}`;
  });
  return lines.join("\n");
}

export function snapshotTokenBudget(text: string, max = 200): { ok: boolean; approxTokens: number } {
  const approxTokens = Math.ceil(text.length / 4);
  return { ok: approxTokens <= max, approxTokens };
}
