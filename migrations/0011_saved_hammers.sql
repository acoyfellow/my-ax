-- Saved hammers: owner-approved work_code recipes promoted from proven work.
CREATE TABLE IF NOT EXISTS saved_hammers (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    input_schema_json TEXT NOT NULL,
    code TEXT NOT NULL,
    capabilities_json TEXT NOT NULL,
    source_run_id TEXT,
    status TEXT NOT NULL DEFAULT 'enabled',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_hammers_owner_name ON saved_hammers(owner_email, name);
CREATE INDEX IF NOT EXISTS idx_saved_hammers_owner_updated ON saved_hammers(owner_email, updated_at DESC);
