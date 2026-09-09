ALTER TABLE sessions ADD COLUMN stable_name TEXT;

CREATE UNIQUE INDEX idx_sessions_owner_stable_name
  ON sessions(owner_email, stable_name)
  WHERE stable_name IS NOT NULL;
