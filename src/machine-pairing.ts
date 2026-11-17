const MACHINE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const MACHINE_TITLE_MAX = 80;

export type MachineState = "pending" | "approved" | "logged_out";
export type MachineRecord = { name: string; title: string; state: MachineState; createdAt: number; lastSeenAt: number | null };
export type MachineAdmission = { admitted: true; state: "approved" } | { admitted: false; state: "pending" | "logged_out" };

type MachineRow = { name: string; title: string | null; created_at: number; approved_at: number | null; logged_out_at: number | null; last_seen_at: number | null };

export function normalizeMachineName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  return MACHINE_NAME_PATTERN.test(name) ? name : null;
}

export function machineHostKey(ownerEmail: string, machineName: string): string {
  return `${ownerEmail.toLowerCase()}#${machineName}`;
}

function stateOf(row: Pick<MachineRow, "approved_at" | "logged_out_at">): MachineState {
  if (row.logged_out_at !== null) return "logged_out";
  return row.approved_at !== null ? "approved" : "pending";
}

export async function admitMachine(db: D1Database, ownerEmail: string, name: string, now = Date.now()): Promise<MachineAdmission> {
  const owner = ownerEmail.toLowerCase();
  await db.prepare("INSERT INTO machines (owner_email, name, credential_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (owner_email, name) DO UPDATE SET last_seen_at = excluded.last_seen_at")
    .bind(owner, name, `login:${owner}#${name}`, now, now).run();
  const row = await db.prepare("SELECT approved_at, logged_out_at FROM machines WHERE owner_email = ? AND name = ?")
    .bind(owner, name).first<Pick<MachineRow, "approved_at" | "logged_out_at">>();
  const state = row ? stateOf(row) : "pending";
  return state === "approved" ? { admitted: true, state } : { admitted: false, state };
}

export async function listMachines(db: D1Database, ownerEmail: string): Promise<MachineRecord[]> {
  const { results } = await db.prepare("SELECT name, title, created_at, approved_at, logged_out_at, last_seen_at FROM machines WHERE owner_email = ? ORDER BY CASE WHEN logged_out_at IS NOT NULL THEN 2 WHEN approved_at IS NULL THEN 0 ELSE 1 END, created_at, name")
    .bind(ownerEmail.toLowerCase()).all<MachineRow>();
  return results.map((row) => ({ name: row.name, title: row.title?.trim() || row.name, state: stateOf(row), createdAt: row.created_at, lastSeenAt: row.last_seen_at }));
}

async function changed(statement: D1PreparedStatement): Promise<boolean> {
  const result = await statement.run();
  return (result.meta.changes ?? 0) > 0;
}

export function approveMachine(db: D1Database, ownerEmail: string, name: string, now = Date.now()): Promise<boolean> {
  return changed(db.prepare("UPDATE machines SET approved_at = ?, logged_out_at = NULL WHERE owner_email = ? AND name = ?").bind(now, ownerEmail.toLowerCase(), name));
}

export function logOutMachine(db: D1Database, ownerEmail: string, name: string, now = Date.now()): Promise<boolean> {
  return changed(db.prepare("UPDATE machines SET logged_out_at = ? WHERE owner_email = ? AND name = ? AND logged_out_at IS NULL").bind(now, ownerEmail.toLowerCase(), name));
}

export async function logOutAllMachines(db: D1Database, ownerEmail: string, now = Date.now()): Promise<string[]> {
  const { results } = await db.prepare("UPDATE machines SET logged_out_at = ? WHERE owner_email = ? AND logged_out_at IS NULL RETURNING name")
    .bind(now, ownerEmail.toLowerCase()).all<{ name: string }>();
  return results.map((row) => row.name);
}

export function forgetMachine(db: D1Database, ownerEmail: string, name: string): Promise<boolean> {
  return changed(db.prepare("DELETE FROM machines WHERE owner_email = ? AND name = ? AND logged_out_at IS NOT NULL").bind(ownerEmail.toLowerCase(), name));
}

export function cleanMachineTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const title = raw.replace(/\s+/g, " ").trim().slice(0, MACHINE_TITLE_MAX);
  return title || null;
}

export async function renameMachine(db: D1Database, ownerEmail: string, name: string, rawTitle: unknown): Promise<string | null> {
  const title = cleanMachineTitle(rawTitle);
  if (!title) return null;
  const ok = await changed(db.prepare("UPDATE machines SET title = ? WHERE owner_email = ? AND name = ?").bind(title, ownerEmail.toLowerCase(), name));
  return ok ? title : null;
}
