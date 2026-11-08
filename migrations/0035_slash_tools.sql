CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  instructions TEXT NOT NULL,
  allowed_tools_json TEXT NOT NULL DEFAULT '[]',
  source_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_owner_name ON skills(owner_email, name);

CREATE TABLE IF NOT EXISTS command_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_email TEXT NOT NULL,
  command_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 1,
  ms INTEGER,
  used_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_command_usage_owner_used ON command_usage(owner_email, used_at DESC);
CREATE INDEX IF NOT EXISTS idx_command_usage_owner_command ON command_usage(owner_email, command_id);
