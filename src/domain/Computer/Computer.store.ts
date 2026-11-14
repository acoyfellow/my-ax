import { CreateComputerSnapshot } from "../ComputerSnapshot/CreateComputerSnapshot.command";
import { ComputerSnapshot } from "../ComputerSnapshot/ComputerSnapshot.aggregate";
import { DeleteComputerSnapshot } from "../ComputerSnapshot/DeleteComputerSnapshot.command";
import { UpdateComputerSnapshot } from "../ComputerSnapshot/UpdateComputerSnapshot.command";
import { decide } from "../decide";
import { Computer } from "./Computer.aggregate";
import { CreateComputer } from "./CreateComputer.command";
import { DeleteComputer } from "./DeleteComputer.command";
import { UpdateComputer } from "./UpdateComputer.command";

type Statement = { run(): Promise<{ meta?: { changes?: number } }>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results?: T[] }> };
export type ComputerStoreDb = {
  prepare(sql: string): { bind(...values: unknown[]): Statement };
  batch(statements: Statement[]): Promise<unknown>;
};

type ComputerKey = { owner: string; computerId: string };
const ref = ({ owner, computerId }: ComputerKey) => `${owner}/${computerId}`;

async function loadComputer(db: ComputerStoreDb, key: ComputerKey) {
  const row = await db.prepare("SELECT title FROM computers WHERE owner_email = ? AND computer_id = ?").bind(key.owner, key.computerId).first<{ title: string }>();
  return row ? { _tag: "Present" as const, ownerEmail: key.owner, title: row.title } : { _tag: "Missing" as const };
}

async function loadSnapshot(db: ComputerStoreDb, key: ComputerKey) {
  const row = await db.prepare("SELECT backup_id, backup_dir, snapshot_version FROM computer_snapshots WHERE owner_email = ? AND computer_id = ?")
    .bind(key.owner, key.computerId).first<{ backup_id: string; backup_dir: string; snapshot_version: number }>();
  return row
    ? { _tag: "Present" as const, ownerEmail: key.owner, backupId: row.backup_id, backupDir: row.backup_dir, snapshotVersion: row.snapshot_version }
    : { _tag: "Missing" as const };
}

export async function ensureComputer(db: ComputerStoreDb, key: ComputerKey, title: string): Promise<void> {
  const state = await loadComputer(db, key);
  if (state._tag === "Present") {
    decide(Computer, ref(key), state, new UpdateComputer({ title: state.title }));
    await db.prepare("UPDATE computers SET updated_at = datetime('now') WHERE owner_email = ? AND computer_id = ?").bind(key.owner, key.computerId).run();
    return;
  }
  decide(Computer, ref(key), state, new CreateComputer({ ownerEmail: key.owner, title }));
  await db.prepare(
    `INSERT INTO computers (owner_email, computer_id, title, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(owner_email, computer_id) DO UPDATE SET updated_at = datetime('now')`,
  ).bind(key.owner, key.computerId, title).run();
}

export async function retitleComputer(db: ComputerStoreDb, key: ComputerKey, title: string): Promise<boolean> {
  const state = await loadComputer(db, key);
  if (state._tag !== "Present") return false;
  decide(Computer, ref(key), state, new UpdateComputer({ title }));
  const result = await db.prepare("UPDATE computers SET title = ?, updated_at = datetime('now') WHERE owner_email = ? AND computer_id = ?")
    .bind(title, key.owner, key.computerId).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function computerExists(db: ComputerStoreDb, key: ComputerKey): Promise<boolean> {
  return (await loadComputer(db, key))._tag === "Present";
}

export async function removeComputer(db: ComputerStoreDb, key: ComputerKey): Promise<void> {
  decide(Computer, ref(key), await loadComputer(db, key), new DeleteComputer());
  const snapshot = await loadSnapshot(db, key);
  if (snapshot._tag === "Present") decide(ComputerSnapshot, ref(key), snapshot, new DeleteComputerSnapshot());
  await db.batch([
    db.prepare("DELETE FROM computer_snapshots WHERE owner_email = ? AND computer_id = ?").bind(key.owner, key.computerId),
    db.prepare("DELETE FROM computers WHERE owner_email = ? AND computer_id = ?").bind(key.owner, key.computerId),
  ]);
}

export async function recordComputerSnapshot(db: ComputerStoreDb, key: ComputerKey, backupId: string, backupDir: string): Promise<void> {
  const snapshot = await loadSnapshot(db, key);
  if (snapshot._tag === "Present") {
    decide(ComputerSnapshot, ref(key), snapshot, new UpdateComputerSnapshot({ backupId, backupDir, snapshotVersion: snapshot.snapshotVersion + 1 }));
  } else {
    decide(ComputerSnapshot, ref(key), snapshot, new CreateComputerSnapshot({ ownerEmail: key.owner, backupId, backupDir, snapshotVersion: 1 }));
  }
  await db.prepare(
    `INSERT INTO computer_snapshots(owner_email, computer_id, backup_id, backup_dir, snapshot_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
     ON CONFLICT(owner_email, computer_id) DO UPDATE SET
       backup_id=excluded.backup_id,
       backup_dir=excluded.backup_dir,
       snapshot_version=computer_snapshots.snapshot_version + 1,
       updated_at=datetime('now')`,
  ).bind(key.owner, key.computerId, backupId, backupDir).run();
}
