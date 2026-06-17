-- Durable owner-scoped one-off artifacts.
--
-- The first slice intentionally has no revisions, sharing, or library UI. The
-- metadata row prepares a future owner library while each artifact remains
-- attached to exactly one conversation. Deleting that conversation removes the
-- D1 row; the route also removes the R2 object explicitly because D1 cannot
-- cascade into object storage.

CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    source_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artifacts_owner_created
    ON artifacts(owner_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_artifacts_session
    ON artifacts(session_id, created_at DESC);
