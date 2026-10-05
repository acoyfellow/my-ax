ALTER TABLE workspace_snapshots ADD COLUMN size_bytes INTEGER;
CREATE TABLE IF NOT EXISTS workspace_snapshot_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_key TEXT NOT NULL,
  backup_id TEXT NOT NULL,
  backup_dir TEXT NOT NULL,
  size_bytes INTEGER,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workspace_snapshot_history_key ON workspace_snapshot_history(workspace_key, created_at DESC);
