import { decide } from "../decide";
import { CreatePushSubscription } from "./CreatePushSubscription.command";
import { DeletePushSubscription } from "./DeletePushSubscription.command";
import { PushSubscription } from "./PushSubscription.aggregate";
import { UpdatePushSubscription } from "./UpdatePushSubscription.command";

type Statement = { run(): Promise<unknown>; first<T>(): Promise<T | null> };
export type PushDb = { prepare(sql: string): { bind(...values: unknown[]): Statement } };

async function ownerOf(db: PushDb, endpoint: string): Promise<string | null> {
  const row = await db.prepare("SELECT owner_email FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).first<{ owner_email: string }>();
  return row?.owner_email ?? null;
}

export async function savePushSubscription(db: PushDb, input: { id: string; owner: string; endpoint: string; subscriptionJson: string }): Promise<void> {
  const owner = await ownerOf(db, input.endpoint);
  if (owner !== null) {
    decide(PushSubscription, input.endpoint, { _tag: "Present", ownerEmail: owner, endpoint: input.endpoint }, new UpdatePushSubscription({ endpoint: input.endpoint }));
  } else {
    decide(PushSubscription, input.endpoint, { _tag: "Missing" }, new CreatePushSubscription({ ownerEmail: input.owner, endpoint: input.endpoint }));
  }
  await db.prepare(`INSERT INTO push_subscriptions(id, owner_email, endpoint, subscription_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(endpoint) DO UPDATE SET subscription_json=excluded.subscription_json, updated_at=datetime('now')`)
    .bind(input.id, input.owner, input.endpoint, input.subscriptionJson).run();
}

export async function removePushSubscription(db: PushDb, owner: string, endpoint: string): Promise<void> {
  const current = await ownerOf(db, endpoint);
  if (current !== owner) return;
  decide(PushSubscription, endpoint, { _tag: "Present", ownerEmail: owner, endpoint }, new DeletePushSubscription());
  await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND owner_email = ?").bind(endpoint, owner).run();
}
