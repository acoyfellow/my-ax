ALTER TABLE sessions ADD COLUMN parent_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_owner_parent
  ON sessions(owner_email, parent_id)
  WHERE parent_id IS NOT NULL;
