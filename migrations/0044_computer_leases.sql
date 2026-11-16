CREATE TABLE IF NOT EXISTS computer_leases (
  owner_email TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  holder TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_email, computer_id)
);
