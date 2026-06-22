import assert from "node:assert/strict";
import test from "node:test";
import { requireOwnedSession, SessionOwnershipCheckError } from "./session-ownership";

function envWithResult(result: { id: string } | null, failure?: Error) {
  const binds: unknown[] = [];
  const statement = {
    bind(...values: unknown[]) {
      binds.push(...values);
      return statement;
    },
    async first() {
      if (failure) throw failure;
      return result;
    },
  };
  return {
    env: { DB: { prepare: () => statement } } as any,
    binds,
  };
}

test("session ownership accepts only an owned row and normalizes email", async () => {
  const { env, binds } = envWithResult({ id: "session-1" });
  assert.equal(await requireOwnedSession(env, "session-1", "Owner@Example.COM"), true);
  assert.deepEqual(binds, ["session-1", "owner@example.com"]);
});

test("session ownership rejects missing rows", async () => {
  const { env } = envWithResult(null);
  assert.equal(await requireOwnedSession(env, "foreign", "owner@example.com"), false);
});

test("session ownership fails closed with a typed error when the database check fails", async () => {
  const { env } = envWithResult(null, new Error("D1 unavailable"));
  await assert.rejects(
    () => requireOwnedSession(env, "session-1", "owner@example.com"),
    (error) => error instanceof SessionOwnershipCheckError
      && error.message === "Unable to verify session ownership"
      && error.cause instanceof Error
      && error.cause.message === "D1 unavailable",
  );
});
