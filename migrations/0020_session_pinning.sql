-- Pinned/starred conversations.
--
-- Pin state and user-defined order are owner-scoped and server-authoritative
-- so they sync across every device. `pin_rank` is a fractional-index string
-- (base-62, lexicographically sortable) so a device can insert between two
-- neighbors without renumbering siblings; concurrent non-overlapping reorders
-- commute. `pin_updated_at` drives per-row last-writer-wins when two devices
-- move the SAME conversation.
--
-- Rollback: DROP INDEX idx_sessions_owner_pinned; ALTER TABLE sessions DROP
-- COLUMN pin_updated_at; DROP COLUMN pin_rank; DROP COLUMN pinned; (D1/SQLite
-- supports DROP COLUMN.) The columns are additive and nullable/defaulted, so
-- rolling the worker back to a pre-0020 build simply ignores them — no data
-- loss for unpinned rows and existing ordering (updated_at) is unaffected.
ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN pin_rank TEXT;
ALTER TABLE sessions ADD COLUMN pin_updated_at TEXT;

-- Serve the pinned group first, in rank order, without a filesort.
CREATE INDEX IF NOT EXISTS idx_sessions_owner_pinned
  ON sessions(owner_email, pinned DESC, pin_rank ASC);
