import { normalizeComputerId } from "./computer-id";
import { computerExists, ensureComputer, recordComputerSnapshot, removeComputer, retitleComputer } from "./domain/Computer/Computer.store";

export async function saveComputerSnapshot(rawDb: unknown, ownerEmail: string, rawId: string, backupId: string, backupDir: string): Promise<void> {
  await recordComputerSnapshot(rawDb as ComputerDb, { owner: ownerEmail.toLowerCase(), computerId: normalizeComputerId(rawId) }, backupId, backupDir);
}

export type ComputerRow = { computer_id: string; title: string; backup_id: string | null; created_at: string; updated_at: string };

type Statement = { run(): Promise<{ meta?: { changes?: number } }>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results?: T[] }> };
export type ComputerDb = {
  prepare(sql: string): { bind(...values: unknown[]): Statement };
  batch(statements: Statement[]): Promise<unknown>;
};
type Owner = { email: string };
type HasDb = { DB: unknown };

const SELECT_COMPUTER = `SELECT c.computer_id, c.title, s.backup_id, c.created_at, c.updated_at
  FROM computers c LEFT JOIN computer_snapshots s ON s.owner_email = c.owner_email AND s.computer_id = c.computer_id
  WHERE c.owner_email = ?`;

const db = (env: HasDb) => env.DB as ComputerDb;
const ownerOf = (identity: Owner) => identity.email.toLowerCase();

export async function listNamedComputers(env: HasDb, identity: Owner): Promise<ComputerRow[]> {
  const rows = await db(env).prepare(`${SELECT_COMPUTER} ORDER BY c.updated_at DESC`).bind(ownerOf(identity)).all<ComputerRow>();
  return rows.results ?? [];
}

export async function getComputerRow(env: HasDb, identity: Owner, rawId: string): Promise<ComputerRow | null> {
  return db(env).prepare(`${SELECT_COMPUTER} AND c.computer_id = ?`).bind(ownerOf(identity), normalizeComputerId(rawId)).first<ComputerRow>();
}

export async function recordComputer(env: HasDb, identity: Owner, rawId: string, title?: string): Promise<ComputerRow> {
  const computerId = normalizeComputerId(rawId);
  const cleanTitle = (title ?? "").trim().slice(0, 80) || computerId;
  await ensureComputer(db(env), { owner: ownerOf(identity), computerId }, cleanTitle);
  const row = await getComputerRow(env, identity, computerId);
  if (!row) throw new Error("computer record was not saved");
  return row;
}

export async function renameComputer(env: HasDb, identity: Owner, rawId: string, title: string): Promise<boolean> {
  const cleanTitle = title.trim().slice(0, 80);
  if (!cleanTitle) throw new Error("Computer name is required.");
  return retitleComputer(db(env), { owner: ownerOf(identity), computerId: normalizeComputerId(rawId) }, cleanTitle);
}

export async function deleteComputerRecord(rawDb: unknown, ownerEmail: string, rawId: string, destroy: () => Promise<unknown>): Promise<boolean> {
  const database = rawDb as ComputerDb;
  const computerId = normalizeComputerId(rawId);
  const owner = ownerEmail.toLowerCase();
  const key = { owner, computerId };
  if (!(await computerExists(database, key))) return false;
  await destroy().catch((error: unknown) => {
    console.warn("named_computer.destroy_failed", { computerId, error: error instanceof Error ? error.message : String(error) });
  });
  await removeComputer(database, key);
  return true;
}
