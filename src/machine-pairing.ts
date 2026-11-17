export const PAIR_CODE_TTL_MS = 30 * 60 * 1000;
export const MACHINE_CREDENTIAL_PREFIX = "mxm_";
const MACHINE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PAIR_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export type MachineRecord = { name: string; title: string; createdAt: number; revokedAt: number | null };
export const MACHINE_TITLE_MAX = 80;
export type MachineIdentity = { ownerEmail: string; name: string };
export type PairOutcome =
  | { ok: true; name: string; credential: string }
  | { ok: false; code: "BAD_NAME" | "BAD_CODE" | "NAME_TAKEN"; message: string };

export function normalizeMachineName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  return MACHINE_NAME_PATTERN.test(name) ? name : null;
}

export function machineHostKey(ownerEmail: string, machineName: string): string {
  return `${ownerEmail.toLowerCase()}#${machineName}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomPairCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const letters = [...bytes].map((byte) => PAIR_CODE_ALPHABET[byte % PAIR_CODE_ALPHABET.length]).join("");
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

function randomCredential(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return MACHINE_CREDENTIAL_PREFIX + [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalPairCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function createPairCode(db: D1Database, ownerEmail: string, now = Date.now()): Promise<{ code: string; expiresAt: number }> {
  const code = randomPairCode();
  const expiresAt = now + PAIR_CODE_TTL_MS;
  await db.prepare("INSERT INTO machine_pair_codes (code_hash, owner_email, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256Hex(canonicalPairCode(code)), ownerEmail.toLowerCase(), expiresAt).run();
  return { code, expiresAt };
}

export async function redeemPairCode(db: D1Database, code: string, rawName: string, now = Date.now()): Promise<PairOutcome> {
  const name = normalizeMachineName(rawName);
  if (!name) return { ok: false, code: "BAD_NAME", message: "Machine name must be 1-63 lowercase letters, digits or dashes, starting with a letter or digit." };
  const codeHash = await sha256Hex(canonicalPairCode(code));
  const claimed = await db.prepare("UPDATE machine_pair_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING owner_email")
    .bind(now, codeHash, now).first<{ owner_email: string }>();
  if (!claimed) return { ok: false, code: "BAD_CODE", message: "This pairing code is unknown, already used or expired. Make a new one in my-ax." };
  const existing = await db.prepare("SELECT revoked_at FROM machines WHERE owner_email = ? AND name = ?")
    .bind(claimed.owner_email, name).first<{ revoked_at: number | null }>();
  if (existing && existing.revoked_at === null) return { ok: false, code: "NAME_TAKEN", message: `A machine named ${name} is already paired. Revoke it first or pick another name.` };
  const credential = randomCredential();
  await db.prepare("INSERT INTO machines (owner_email, name, credential_hash, created_at, revoked_at) VALUES (?, ?, ?, ?, NULL) ON CONFLICT (owner_email, name) DO UPDATE SET credential_hash = excluded.credential_hash, created_at = excluded.created_at, revoked_at = NULL")
    .bind(claimed.owner_email, name, await sha256Hex(credential), now).run();
  return { ok: true, name, credential };
}

export async function machineForCredential(db: D1Database, credential: string): Promise<MachineIdentity | null> {
  if (!credential.startsWith(MACHINE_CREDENTIAL_PREFIX)) return null;
  const row = await db.prepare("SELECT owner_email, name FROM machines WHERE credential_hash = ? AND revoked_at IS NULL")
    .bind(await sha256Hex(credential)).first<{ owner_email: string; name: string }>();
  return row ? { ownerEmail: row.owner_email, name: row.name } : null;
}

export async function listMachines(db: D1Database, ownerEmail: string): Promise<MachineRecord[]> {
  const { results } = await db.prepare("SELECT name, title, created_at, revoked_at FROM machines WHERE owner_email = ? AND revoked_at IS NULL ORDER BY created_at, name")
    .bind(ownerEmail.toLowerCase()).all<{ name: string; title: string | null; created_at: number; revoked_at: number | null }>();
  return results.map((row) => ({ name: row.name, title: row.title?.trim() || row.name, createdAt: row.created_at, revokedAt: row.revoked_at }));
}

export async function revokeMachine(db: D1Database, ownerEmail: string, name: string, now = Date.now()): Promise<boolean> {
  const result = await db.prepare("UPDATE machines SET revoked_at = ? WHERE owner_email = ? AND name = ? AND revoked_at IS NULL")
    .bind(now, ownerEmail.toLowerCase(), name).run();
  return (result.meta.changes ?? 0) > 0;
}

export function cleanMachineTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const title = raw.replace(/\s+/g, " ").trim().slice(0, MACHINE_TITLE_MAX);
  return title || null;
}

export async function renameMachine(db: D1Database, ownerEmail: string, name: string, rawTitle: unknown): Promise<string | null> {
  const title = cleanMachineTitle(rawTitle);
  if (!title) return null;
  const result = await db.prepare("UPDATE machines SET title = ? WHERE owner_email = ? AND name = ? AND revoked_at IS NULL")
    .bind(title, ownerEmail.toLowerCase(), name).run();
  return (result.meta.changes ?? 0) > 0 ? title : null;
}
