import { Effect } from "effect";
import { Database, type DatabaseError } from "../../effect/database";
import { decide } from "../decide";
import { CreateOwnerPreference } from "./CreateOwnerPreference.command";
import { DeleteOwnerPreference } from "./DeleteOwnerPreference.command";
import { OwnerPreference } from "./OwnerPreference.aggregate";
import { UpdateOwnerPreference } from "./UpdateOwnerPreference.command";

type Statement = { run(): Promise<{ meta?: { changes?: number } } | unknown>; first<T>(): Promise<T | null> };
export type PreferenceDb = { prepare(sql: string): { bind(...values: unknown[]): Statement } };

const ref = (owner: string, key: string) => `${owner}/${key}`;
const changes = (result: unknown) => Number((result as { meta?: { changes?: number } })?.meta?.changes ?? 0);

export const PUT_PREFERENCE_SQL = `INSERT INTO owner_preferences (owner_email, preference_key, value_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_email, preference_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`;
export const DELETE_PREFERENCE_SQL = "DELETE FROM owner_preferences WHERE owner_email = ? AND preference_key = ?";
const INSERT_IF_ABSENT_SQL = `INSERT INTO owner_preferences(owner_email, preference_key, value_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_email, preference_key) DO NOTHING`;
const COMPARE_AND_SWAP_SQL = `UPDATE owner_preferences SET value_json = ?, updated_at = ?
    WHERE owner_email = ? AND preference_key = ? AND value_json = ?`;

export function decidePreferencePut(owner: string, key: string, exists: boolean, valueJson: string): void {
  if (exists) decide(OwnerPreference, ref(owner, key), { _tag: "Present", ownerEmail: owner, valueJson: "" }, new UpdateOwnerPreference({ valueJson }));
  else decide(OwnerPreference, ref(owner, key), { _tag: "Missing" }, new CreateOwnerPreference({ ownerEmail: owner, valueJson }));
}

export function decidePreferenceDelete(owner: string, key: string): void {
  decide(OwnerPreference, ref(owner, key), { _tag: "Present", ownerEmail: owner, valueJson: "" }, new DeleteOwnerPreference());
}

async function exists(db: PreferenceDb, owner: string, key: string): Promise<boolean> {
  return (await db.prepare(PRESENT_SQL).bind(owner, key).first()) !== null;
}

export async function putPreference(db: PreferenceDb, owner: string, key: string, valueJson: string, now: string): Promise<void> {
  decidePreferencePut(owner, key, await exists(db, owner, key), valueJson);
  await db.prepare(PUT_PREFERENCE_SQL).bind(owner, key, valueJson, now, now).run();
}

export async function deletePreference(db: PreferenceDb, owner: string, key: string): Promise<void> {
  if (!(await exists(db, owner, key))) return;
  decidePreferenceDelete(owner, key);
  await db.prepare(DELETE_PREFERENCE_SQL).bind(owner, key).run();
}

const PRESENT_SQL = "SELECT 1 AS present FROM owner_preferences WHERE owner_email = ? AND preference_key = ?";

export function putPreferenceEffect(owner: string, key: string, valueJson: string, now: string): Effect.Effect<void, DatabaseError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const row = yield* database.first<{ present: number }>(PRESENT_SQL, [owner, key]);
    decidePreferencePut(owner, key, row !== null, valueJson);
    yield* database.run(PUT_PREFERENCE_SQL, [owner, key, valueJson, now, now]);
  });
}

export function deletePreferenceEffect(owner: string, key: string): Effect.Effect<void, DatabaseError, Database> {
  return Effect.gen(function* () {
    const database = yield* Database;
    const row = yield* database.first<{ present: number }>(PRESENT_SQL, [owner, key]);
    if (row === null) return;
    decidePreferenceDelete(owner, key);
    yield* database.run(DELETE_PREFERENCE_SQL, [owner, key]);
  });
}

export async function swapPreference(db: PreferenceDb, owner: string, key: string, valueJson: string, now: string, expected: string | null): Promise<boolean> {
  if (expected === null) {
    decidePreferencePut(owner, key, false, valueJson);
    return changes(await db.prepare(INSERT_IF_ABSENT_SQL).bind(owner, key, valueJson, now, now).run()) > 0;
  }
  decidePreferencePut(owner, key, true, valueJson);
  return changes(await db.prepare(COMPARE_AND_SWAP_SQL).bind(valueJson, now, owner, key, expected).run()) > 0;
}
