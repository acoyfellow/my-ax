CREATE TABLE IF NOT EXISTS error_issue_fingerprints (
  owner_email TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  issue_url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner_email, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_error_issue_fingerprints_seen
  ON error_issue_fingerprints(owner_email, last_seen_at DESC);
