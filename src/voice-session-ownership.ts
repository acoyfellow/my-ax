// Owns: fail-closed owner lookup and owner-scoped direct Voice actor naming.
// Called by: the authenticated Voice route in src/index.tsx.
// Does not own: Voice lifecycle, microphone access, or canonical Think turns.

import type { AccessIdentity } from "./auth";

type SessionLookup = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = { id: string }>(): Promise<T | null>;
    };
  };
};

export async function requireOwnedVoiceSession(
  db: SessionLookup,
  identity: AccessIdentity,
  sessionId: string,
): Promise<void> {
  const owned = await db
    .prepare("SELECT id FROM sessions WHERE id = ? AND owner_email = ?")
    .bind(sessionId, identity.email.toLowerCase())
    .first<{ id: string }>();
  if (!owned) throw new Error("Session not found or not owned");
}

export async function resolveOwnedVoiceTarget(db: SessionLookup, identity: AccessIdentity, sessionId: string): Promise<string> {
  await requireOwnedVoiceSession(db, identity, sessionId);
  return `${identity.email.toLowerCase()}:${sessionId}`;
}
