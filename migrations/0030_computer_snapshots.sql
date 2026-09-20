CREATE TABLE IF NOT EXISTS computer_snapshots (
  owner_email TEXT NOT NULL,
  computer_id TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  backup_dir TEXT NOT NULL,
  snapshot_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_email, computer_id)
);
