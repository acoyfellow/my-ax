import { z } from "zod";

export const A2AMessage = z.object({
  messageId: z.string().min(1).max(200),
  role: z.literal("user"),
  parts: z.array(z.object({ kind: z.literal("text"), text: z.string().min(1).max(32_000) }).strict()).min(1).max(32),
  contextId: z.string().min(1).max(200).optional(),
  taskId: z.string().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict().refine((message) => message.parts.reduce((total, part) => total + encoder.encode(part.text).byteLength, 0) <= 32_000, "aggregate text exceeds 32000 bytes");

export const A2A_TASK_STATES = ["input-required", "completed", "rejected", "canceled", "failed"] as const;

export function toA2ATask(task: { id: string; context_id: string; message_id: string; text: string; state: string; created_at: string; updated_at: string }) {
  return {
    id: task.id,
    contextId: task.context_id,
    status: { state: task.state, timestamp: task.updated_at },
    history: [{ messageId: task.message_id, role: "user", parts: [{ kind: "text", text: task.text }] }],
    metadata: { "my-ax/owner-reviewed": true },
  };
}

const encoder = new TextEncoder();
function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
export function newGrantToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `ax_a2a_${btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}`;
}
export function bearer(header: string | undefined): string | null {
  const match = header?.match(/^Bearer ([A-Za-z0-9_-]{20,})$/);
  return match?.[1] ?? null;
}
export async function messageHash(message: z.infer<typeof A2AMessage>): Promise<string> {
  return sha256(JSON.stringify(message));
}
