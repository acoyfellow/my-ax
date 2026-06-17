-- Owner authorization index for Browser Rendering recordings.
CREATE TABLE IF NOT EXISTS browser_recordings (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_browser_recordings_owner ON browser_recordings(owner_email, created_at DESC);
