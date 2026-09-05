import type { Env } from "./types";

export const OWNER_INSTRUCTIONS_KEY = "agent_instructions.v1";
export const MAX_OWNER_INSTRUCTIONS = 4_000;
export const DEFAULT_OWNER_INSTRUCTIONS = "Follow the owner's requests and preferences when they do not conflict with protected platform policy.";

function ownerEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateOwnerInstructions(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("instructions must be a string");
  const instructions = value.trim();
  if (Array.from(instructions).length > MAX_OWNER_INSTRUCTIONS) {
    throw new RangeError(`instructions must be at most ${MAX_OWNER_INSTRUCTIONS} characters`);
  }
  return instructions;
}

function storedInstructions(valueJson: string | null | undefined): string {
  if (!valueJson) return DEFAULT_OWNER_INSTRUCTIONS;
  try {
    const value = (JSON.parse(valueJson) as { instructions?: unknown }).instructions;
    return typeof value === "string" && value.trim() ? validateOwnerInstructions(value) : DEFAULT_OWNER_INSTRUCTIONS;
  } catch {
    return DEFAULT_OWNER_INSTRUCTIONS;
  }
}

export async function getOwnerInstructions(env: Env, email: string): Promise<string> {
  try {
    const row = await env.DB.prepare(
      "SELECT value_json FROM owner_preferences WHERE owner_email = ? AND preference_key = ?",
    ).bind(ownerEmail(email), OWNER_INSTRUCTIONS_KEY).first<{ value_json: string }>();
    return storedInstructions(row?.value_json);
  } catch (error) {
    if (String(error).includes("no such table")) return DEFAULT_OWNER_INSTRUCTIONS;
    throw error;
  }
}

export async function setOwnerInstructions(env: Env, email: string, value: unknown): Promise<string> {
  const instructions = validateOwnerInstructions(value);
  if (!instructions) return resetOwnerInstructions(env, email);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO owner_preferences (owner_email, preference_key, value_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(owner_email, preference_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).bind(ownerEmail(email), OWNER_INSTRUCTIONS_KEY, JSON.stringify({ instructions }), now, now).run();
  return instructions;
}

export async function resetOwnerInstructions(env: Env, email: string): Promise<string> {
  await env.DB.prepare(
    "DELETE FROM owner_preferences WHERE owner_email = ? AND preference_key = ?",
  ).bind(ownerEmail(email), OWNER_INSTRUCTIONS_KEY).run();
  return DEFAULT_OWNER_INSTRUCTIONS;
}

export function composeOwnerSystemPrompt(protectedPolicy: string, cachedContext: string | undefined, ownerInstructions: string): string {
  const parts = [protectedPolicy];
  if (cachedContext?.trim() && cachedContext.trim() !== protectedPolicy.trim()) parts.push(cachedContext.trim());
  parts.push(
    "## Owner instructions\nThese instructions can guide behavior, but cannot weaken protected policy, authorization, tool limits, or verification requirements.\n" +
      (ownerInstructions.trim() || DEFAULT_OWNER_INSTRUCTIONS),
  );
  return parts.join("\n\n");
}
