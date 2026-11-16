import { decide, DomainRejected } from "../decide";
import { AcquireComputerLease } from "./AcquireComputerLease.command";
import { ComputerLease, heldByOther, type ComputerLeaseState } from "./ComputerLease.aggregate";
import { ReleaseComputerLease } from "./ReleaseComputerLease.command";

type Statement = { run(): Promise<{ meta?: { changes?: number } }>; first<T>(): Promise<T | null> };
export type LeaseDb = { prepare(sql: string): { bind(...values: unknown[]): Statement } };

export type LeaseKey = { owner: string; computerId: string };
export type LeaseView = { computerId: string; holder: string | null; expiresAt: string | null; held: boolean };

export const LEASE_MAX_SECONDS = 24 * 60 * 60;
export const LEASE_DEFAULT_SECONDS = 30 * 60;

export class ComputerLeaseHeldError extends Error {
  constructor(readonly lease: LeaseView) {
    super(`computer ${lease.computerId} is leased by ${lease.holder} until ${lease.expiresAt}`);
  }
}

const ref = ({ owner, computerId }: LeaseKey) => `${owner}/${computerId}`;

export async function loadLease(db: LeaseDb, key: LeaseKey): Promise<ComputerLeaseState> {
  const row = await db.prepare("SELECT holder, expires_at FROM computer_leases WHERE owner_email = ? AND computer_id = ?")
    .bind(key.owner, key.computerId).first<{ holder: string; expires_at: number }>();
  return row ? { _tag: "Held", holder: row.holder, expiresAt: row.expires_at } : { _tag: "Free" };
}

export function leaseView(computerId: string, state: ComputerLeaseState, now: number): LeaseView {
  const live = state._tag === "Held" && state.expiresAt > now;
  return {
    computerId,
    holder: live ? state.holder : null,
    expiresAt: live ? new Date(state.expiresAt).toISOString() : null,
    held: live,
  };
}

export function leaseSeconds(value: unknown): number {
  const seconds = Math.floor(Number(value));
  if (!Number.isFinite(seconds) || seconds <= 0) return LEASE_DEFAULT_SECONDS;
  return Math.min(seconds, LEASE_MAX_SECONDS);
}

export async function acquireLease(db: LeaseDb, key: LeaseKey, holder: string, seconds: number, now = Date.now()): Promise<LeaseView> {
  const state = await loadLease(db, key);
  const expiresAt = now + seconds * 1000;
  try {
    decide(ComputerLease, ref(key), state, new AcquireComputerLease({ holder, expiresAt, now }));
  } catch (error) {
    if (error instanceof DomainRejected) throw new ComputerLeaseHeldError(leaseView(key.computerId, state, now));
    throw error;
  }
  const written = await db.prepare(
    `INSERT INTO computer_leases (owner_email, computer_id, holder, expires_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(owner_email, computer_id) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at, updated_at = excluded.updated_at
     WHERE computer_leases.holder = excluded.holder OR computer_leases.expires_at <= ?`,
  ).bind(key.owner, key.computerId, holder, expiresAt, now).run();
  if (!written.meta?.changes) throw new ComputerLeaseHeldError(leaseView(key.computerId, await loadLease(db, key), now));
  return leaseView(key.computerId, { _tag: "Held", holder, expiresAt }, now);
}

export async function releaseLease(db: LeaseDb, key: LeaseKey, holder: string, now = Date.now()): Promise<boolean> {
  const state = await loadLease(db, key);
  try {
    decide(ComputerLease, ref(key), state, new ReleaseComputerLease({ holder, now }));
  } catch (error) {
    if (error instanceof DomainRejected) return false;
    throw error;
  }
  const deleted = await db.prepare("DELETE FROM computer_leases WHERE owner_email = ? AND computer_id = ? AND holder = ?").bind(key.owner, key.computerId, holder).run();
  return Boolean(deleted.meta?.changes);
}

export async function requireLeaseFree(db: LeaseDb, key: LeaseKey, holder: string | undefined, now = Date.now()): Promise<void> {
  const state = await loadLease(db, key);
  if (heldByOther(state, holder ?? "", now)) throw new ComputerLeaseHeldError(leaseView(key.computerId, state, now));
}
