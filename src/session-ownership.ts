// Owns: the shared fail-closed session-row ownership predicate.
// Called by: authenticated routes before resolving or mutating a session facet.
// Does not own: Access authentication, facet routing, or session lifecycle.

import type { Env } from "./types";

export async function requireOwnedSession(
  env: Pick<Env, "DB">,
  sessionId: string,
  ownerEmail: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT id FROM sessions WHERE id = ? AND owner_email = ?",
  )
    .bind(sessionId, ownerEmail.toLowerCase())
    .first<{ id: string }>();
  return row !== null;
}
