-- Run Receipts: owner-scoped flight recorder for consequential agent runs.
--
-- v0 keeps artifacts out of D1. Events may point at R2/upload URLs later via
-- evidence_json, but the first dogfood slice is pure structured receipts.

CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    session_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    title TEXT,
    task_summary TEXT NOT NULL,
    bounds_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_runs_owner_updated
    ON runs(owner_email, updated_at DESC);

CREATE TABLE IF NOT EXISTS run_events (
    run_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    ts TEXT NOT NULL,
    actor_json TEXT NOT NULL,
    type TEXT NOT NULL,
    data_json TEXT NOT NULL,
    evidence_json TEXT,
    PRIMARY KEY (run_id, event_id),
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_run_events_owner_ts
    ON run_events(owner_email, ts DESC);

CREATE INDEX IF NOT EXISTS idx_run_events_run_ts
    ON run_events(run_id, ts ASC);

CREATE INDEX IF NOT EXISTS idx_run_events_type
    ON run_events(type);
