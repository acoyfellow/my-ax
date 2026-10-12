CREATE TABLE IF NOT EXISTS observe_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_email TEXT NOT NULL,
  session_id TEXT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  duration_ms INTEGER,
  outcome TEXT,
  message TEXT
);
CREATE INDEX IF NOT EXISTS idx_observe_events_owner_ts ON observe_events(owner_email, ts DESC);
CREATE INDEX IF NOT EXISTS idx_observe_events_session ON observe_events(session_id, ts);
