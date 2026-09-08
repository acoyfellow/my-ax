import type { Env } from "./types";
import { Data, Effect } from "effect";
import { Database, databaseLayer } from "./effect/database";

export class OwnerInstructionsInputError extends Data.TaggedError("OwnerInstructionsInputError")<{ cause: unknown; message: string }> {}

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

export function getOwnerInstructions(env: Env, email: string) {
  return Effect.gen(function* () {
    const db = yield* Database;
    const row = yield* db.first<{ value_json: string }>(
      "SELECT value_json FROM owner_preferences WHERE owner_email = ? AND preference_key = ?",
      [ownerEmail(email), OWNER_INSTRUCTIONS_KEY],
    );
    return storedInstructions(row?.value_json);
  }).pipe(
    Effect.catch((error) => String(error.cause).includes("no such table") ? Effect.succeed(DEFAULT_OWNER_INSTRUCTIONS) : Effect.fail(error)),
    Effect.provide(databaseLayer(env.DB)),
  );
}

export function setOwnerInstructions(env: Env, email: string, value: unknown) {
  return Effect.gen(function* () {
    const instructions = yield* Effect.try({
      try: () => validateOwnerInstructions(value),
      catch: (cause) => new OwnerInstructionsInputError({ cause, message: cause instanceof Error ? cause.message : "Invalid owner instructions" }),
    });
    if (!instructions) return yield* resetOwnerInstructions(env, email);
    const db = yield* Database;
    const now = yield* Effect.sync(() => new Date().toISOString());
    yield* db.run(
      `INSERT INTO owner_preferences (owner_email, preference_key, value_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_email, preference_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [ownerEmail(email), OWNER_INSTRUCTIONS_KEY, JSON.stringify({ instructions }), now, now],
    );
    return instructions;
  }).pipe(Effect.provide(databaseLayer(env.DB)));
}

export function resetOwnerInstructions(env: Env, email: string) {
  return Effect.gen(function* () {
    const db = yield* Database;
    yield* db.run(
      "DELETE FROM owner_preferences WHERE owner_email = ? AND preference_key = ?",
      [ownerEmail(email), OWNER_INSTRUCTIONS_KEY],
    );
    return DEFAULT_OWNER_INSTRUCTIONS;
  }).pipe(Effect.provide(databaseLayer(env.DB)));
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
