-- Reusable Artifact Library: detach definitions from origin conversations.
PRAGMA foreign_keys = OFF;
CREATE TABLE artifacts_library_next (
 id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, session_id TEXT NOT NULL,
 kind TEXT NOT NULL, title TEXT NOT NULL, storage_key TEXT NOT NULL,
 source_hash TEXT NOT NULL, library_saved INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO artifacts_library_next (id, owner_email, session_id, kind, title, storage_key, source_hash, library_saved, created_at, updated_at)
SELECT id, owner_email, session_id, kind, title, storage_key, source_hash, 1, created_at, created_at FROM artifacts;
DROP TABLE artifacts;
ALTER TABLE artifacts_library_next RENAME TO artifacts;
CREATE INDEX idx_artifacts_owner_created ON artifacts(owner_email, created_at DESC);
CREATE INDEX idx_artifacts_session ON artifacts(session_id, created_at DESC);
CREATE INDEX idx_artifacts_owner_updated ON artifacts(owner_email, updated_at DESC);
PRAGMA foreign_keys = ON;
