export const MEMORY_BLOCK_MAX_TOKENS = 4000;

export function estimateMemoryTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

export interface MemoryWriteCheck {
  fits: boolean;
  tokens: number;
  maxTokens: number;
  guidance: string;
}

const MIN_BLOCK_CHARS_FOR_LEAK = 400;
const LEAK_CONTAINMENT_RATIO = 0.9;

function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isMemoryBlockLeak(replyText: string, memoryBlockContent: string | null | undefined): boolean {
  if (!memoryBlockContent) return false;
  const block = normalizeForCompare(memoryBlockContent);
  const reply = normalizeForCompare(replyText);
  if (block.length < MIN_BLOCK_CHARS_FOR_LEAK) return false;
  if (!reply) return false;
  if (reply.includes(block)) return true;
  if (block.includes(reply) && reply.length >= block.length * LEAK_CONTAINMENT_RATIO) return true;
  return false;
}

export function checkMemoryWrite(content: string, maxTokens = MEMORY_BLOCK_MAX_TOKENS): MemoryWriteCheck {
  const tokens = estimateMemoryTokens(content);
  if (tokens <= maxTokens) {
    return { fits: true, tokens, maxTokens, guidance: "" };
  }
  return {
    fits: false,
    tokens,
    maxTokens,
    guidance: `Memory block is full (${tokens}/${maxTokens} tokens). Replace stale lines with a shorter summary instead of appending. Do not paste this block into a chat reply.`,
  };
}
