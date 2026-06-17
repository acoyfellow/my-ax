-- Prevent out-of-order backup completion from replacing a newer owner snapshot.
ALTER TABLE workspace_snapshots ADD COLUMN snapshot_version INTEGER NOT NULL DEFAULT 0;
