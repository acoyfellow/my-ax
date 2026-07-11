// Owns: the shared fail-closed session-row ownership predicate.
// Called by: authenticated routes before resolving or mutating a session facet.
// Does not own: Access authentication, facet routing, or session lifecycle.

import type { Env } from "./types";

export class SessionOwnershipCheckError extends Error {
  constructor(cause: unknown) {
    super("Unable to verify session ownership", { cause });
    this.name = "SessionOwnershipCheckError";
  }
}

export async function requireOwnedSession(
  env: Pick<Env, "DB">,
  sessionId: string,
  ownerEmail: string,
): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      "SELECT id FROM sessions WHERE id = ? AND owner_email = ?",
    )
      .bind(sessionId, ownerEmail.toLowerCase())
      .first<{ id: string }>();
    // Fail closed: require the exact requested row, not merely a non-null value
    // (an adapter returning undefined would slip past `row !== null`).
    return row?.id === sessionId;
  } catch (error) {
    throw new SessionOwnershipCheckError(error);
  }
}
