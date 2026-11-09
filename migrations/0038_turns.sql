CREATE TABLE IF NOT EXISTS turns (
  session_id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  started_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  tools_running INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_turns_owner_heartbeat ON turns(owner_email, heartbeat_at);
