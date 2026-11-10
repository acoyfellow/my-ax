export const ROOT_STABLE_NAME = "root";

export type RootGuardError = { code: "ROOT_PROTECTED" | "NOT_ROOT" | "TURN_RUNNING"; message: string };

type SessionLookup = { stable_name: string | null; status: string } | null;

export function isRootSession(row: SessionLookup): boolean {
  return row?.stable_name === ROOT_STABLE_NAME;
}

export function refuseIfRoot(row: SessionLookup, action: "delete" | "archive"): RootGuardError | null {
  if (!isRootSession(row)) return null;
  return { code: "ROOT_PROTECTED", message: `root cannot be ${action === "delete" ? "deleted" : "archived"}; clear it instead` };
}

export function clearRefusal(row: SessionLookup): RootGuardError | null {
  if (!isRootSession(row)) return { code: "NOT_ROOT", message: "only root can be cleared" };
  if (row?.status === "running") return { code: "TURN_RUNNING", message: "root has a running turn; stop it before clearing" };
  return null;
}

export async function lookupSession(db: D1Database, ownerEmail: string, id: string): Promise<SessionLookup> {
  return db.prepare("SELECT stable_name, status FROM sessions WHERE id = ? AND owner_email = ?")
    .bind(id, ownerEmail)
    .first<{ stable_name: string | null; status: string }>();
}
