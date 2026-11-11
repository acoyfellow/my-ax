export type VoiceCommand =
  | { kind: "open"; target: "desk" | "root" | "attention" | "settings" }
  | { kind: "approve"; card: number }
  | { kind: "dismiss"; card: number }
  | { kind: "stop" }
  | { kind: "ask"; text: string };

export type ParsedVoice = { ok: true; command: VoiceCommand; needsConfirm: boolean } | { ok: false; reason: "no-wake" | "unknown" | "empty" };

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/[,.!?]/g, " ").replace(/\s+/g, " ").trim();
}

const numberWords: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20
};

function parseCardNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  
  if (/\d+\.\d+/.test(trimmed)) return null;
  
  const match = trimmed.match(/^([\w]+)/);
  if (!match) return null;
  
  const numStr = match[1].toLowerCase();
  
  const num = Number(numStr);
  if (!Number.isNaN(num) && Number.isInteger(num) && num >= 1 && num <= 99) {
    return num;
  }
  
  const wordNum = numberWords[numStr];
  if (wordNum !== undefined) {
    return wordNum;
  }
  
  return null;
}

function extractWakeWord(transcript: string): { hasWake: boolean; remaining: string } {
  let text = transcript.trim();
  const lowerText = text.toLowerCase();
  
  let idx = 0;
  if (lowerText.startsWith("hey")) {
    idx = 3;
    while (idx < text.length && /[\s,.!?]/.test(text[idx])) {
      idx++;
    }
    text = text.slice(idx);
  }
  
  const lowerText2 = text.toLowerCase();
  
  const axMatch = lowerText2.match(/^(\s*)(ax)(?=\s|[,.!?]|$)/);
  if (axMatch) {
    const matchEnd = axMatch[1].length + axMatch[2].length;
    let remaining = text.slice(matchEnd);
    remaining = remaining.replace(/^[\s,.!?]+/, "");
    return { hasWake: true, remaining };
  }
  
  const axspaceMatch = lowerText2.match(/^(\s*)(a)(\s+)(x)(?=\s|[,.!?]|$)/);
  if (axspaceMatch) {
    const matchEnd = axspaceMatch[1].length + axspaceMatch[2].length + axspaceMatch[3].length + axspaceMatch[4].length;
    let remaining = text.slice(matchEnd);
    remaining = remaining.replace(/^[\s,.!?]+/, "");
    return { hasWake: true, remaining };
  }
  
  return { hasWake: false, remaining: "" };
}

export function parseVoice(transcript: string): ParsedVoice {
  const { hasWake, remaining } = extractWakeWord(transcript);
  
  if (!hasWake) {
    return { ok: false, reason: "no-wake" };
  }
  
  if (!remaining || remaining.trim().length === 0) {
    return { ok: false, reason: "empty" };
  }
  
  const originalRemaining = remaining;
  const normalized = normalizeText(remaining);
  const tokens = normalized.split(/\s+/);
  
  if (tokens[0] === "open") {
    let targetIdx = 1;
    if (tokens.length > 1 && tokens[1] === "the") {
      targetIdx = 2;
    }
    if (tokens.length > targetIdx) {
      const target = tokens[targetIdx] as "desk" | "root" | "attention" | "settings" | undefined;
      if (target === "desk" || target === "root" || target === "attention" || target === "settings") {
        return { ok: true, command: { kind: "open", target }, needsConfirm: false };
      }
    }
    return { ok: false, reason: "unknown" };
  }
  
  if (tokens[0] === "approve") {
    if (tokens.length >= 3) {
      const cardOrNumber = tokens[1];
      if (cardOrNumber === "card" || cardOrNumber === "number") {
        const match = originalRemaining.match(/(?:card|number)\s+(.*)$/i);
        const numText = match ? match[1] : "";
        const num = parseCardNumber(numText);
        if (num !== null) {
          return { ok: true, command: { kind: "approve", card: num }, needsConfirm: true };
        }
      }
    }
    return { ok: false, reason: "unknown" };
  }
  
  if (tokens[0] === "dismiss") {
    if (tokens.length >= 3) {
      const cardOrNumber = tokens[1];
      if (cardOrNumber === "card" || cardOrNumber === "number") {
        const match = originalRemaining.match(/(?:card|number)\s+(.*)$/i);
        const numText = match ? match[1] : "";
        const num = parseCardNumber(numText);
        if (num !== null) {
          return { ok: true, command: { kind: "dismiss", card: num }, needsConfirm: true };
        }
      }
    }
    return { ok: false, reason: "unknown" };
  }
  
  if (tokens[0] === "stop" && tokens.length === 1) {
    return { ok: true, command: { kind: "stop" }, needsConfirm: false };
  }
  
  if (tokens[0] === "ask") {
    if (originalRemaining.length > 4) {
      const text = originalRemaining.slice(4).trim();
      if (text.length > 0) {
        const cappedText = text.length > 500 ? text.slice(0, 500) : text;
        return { ok: true, command: { kind: "ask", text: cappedText }, needsConfirm: false };
      }
    }
    return { ok: false, reason: "unknown" };
  }
  
  return { ok: false, reason: "unknown" };
}

export function isConfirm(transcript: string): boolean {
  let text = transcript.trim();
  
  const { hasWake, remaining } = extractWakeWord(text);
  if (hasWake) {
    text = remaining;
  }
  
  text = text.replace(/[,.!?]+$/, "").trim();
  
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  
  return normalized === "confirm" || normalized === "yes confirm";
}
