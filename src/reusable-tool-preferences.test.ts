import assert from "node:assert/strict";
import test from "node:test";
import { Effect } from "effect";
import { autoTrustMode } from "./auto-trust";
import { databaseLayer } from "./effect/database";
import {
  reusableToolApprovalMode as reusableToolApprovalModeEffect,
  setReusableToolApprovalMode as setReusableToolApprovalModeEffect,
} from "./reusable-tool-preferences-program";

const reusableToolApprovalMode = (env: ReturnType<typeof envWith>["env"], email: string) => Effect.runPromise(
  reusableToolApprovalModeEffect(email, autoTrustMode(env) === "auto" ? "auto" : "review").pipe(Effect.provide(databaseLayer(env.DB))),
);
const setReusableToolApprovalMode = (
  env: ReturnType<typeof envWith>["env"],
  email: string,
  mode: "review" | "auto",
) => Effect.runPromise(setReusableToolApprovalModeEffect(email, mode).pipe(Effect.provide(databaseLayer(env.DB))));

function envWith(options: { stored?: string | null; missingTable?: boolean; legacyAuto?: boolean } = {}) {
  const writes: unknown[][] = [];
  const env = {
    ...(options.legacyAuto ? { RECIPE_AUTOTRUST: "1" } : {}),
    DB: {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            return {
              async first() {
                if (options.missingTable) throw new Error("D1_ERROR: no such table: owner_preferences");
                return options.stored == null ? null : { value_json: options.stored };
              },
              async run() {
                writes.push([sql, ...values]);
                return { success: true };
              },
            };
          },
        };
      },
    },
  } as any;
  return { env, writes };
}

test("owner reusable-tool preference defaults to review", async () => {
  const { env } = envWith();
  assert.equal(await reusableToolApprovalMode(env, "Owner@Example.com"), "review");
});

test("stored owner choice wins over legacy deploy auto-trust", async () => {
  const { env } = envWith({ stored: JSON.stringify({ approvalMode: "review" }), legacyAuto: true });
  assert.equal(await reusableToolApprovalMode(env, "owner@example.com"), "review");
});

test("legacy deploy auto-trust remains a pre-migration fallback", async () => {
  const { env } = envWith({ missingTable: true, legacyAuto: true });
  assert.equal(await reusableToolApprovalMode(env, "owner@example.com"), "auto");
});

test("setting auto mode is owner-scoped and persisted", async () => {
  const { env, writes } = envWith();
  assert.equal(await setReusableToolApprovalMode(env, "Owner@Example.com", "auto"), "auto");
  assert.equal(writes.length, 1);
  assert.ok(writes[0].includes("owner@example.com"));
  assert.ok(writes[0].includes(JSON.stringify({ approvalMode: "auto" })));
});
