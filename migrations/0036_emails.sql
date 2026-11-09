CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_emails_owner_created ON emails(owner_email, created_at DESC);
