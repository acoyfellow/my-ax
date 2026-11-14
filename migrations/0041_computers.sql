CREATE TABLE IF NOT EXISTS computers (
  owner_email TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_email, computer_id)
);
INSERT OR IGNORE INTO computers (owner_email, computer_id, title, created_at, updated_at)
  SELECT owner_email, computer_id, computer_id, created_at, updated_at FROM computer_snapshots;
