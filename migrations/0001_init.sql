-- my-ax D1 schema — ground zero (collapsed from prior 0001..0004).
--
-- Tables:
--   sessions               — registry of chat sessions owned by an Access user
--   conversation_entries   — canonical transcript log (FTS-searchable)
--   workspace_snapshots    — latest Sandbox backup pointer per owner
--   push_subscriptions     — Web Push endpoints per owner
--   jobs                   — owner-scoped recurring prompts
--
-- All tables are owner-scoped via owner_email. Memory (the new Think Session
-- "memory" context block) lives inside the agent Durable Object's SQLite,
-- not in D1.

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    owner_email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_owner
    ON sessions(owner_email, updated_at DESC);

-- Canonical conversation transcript. Source of truth for transcript replay,
-- sidebar previews, and full-text search. Distinct from the Think Session
-- conversation history inside the agent DO (which is the model's working
-- context); this table is for cross-session human-facing search.
CREATE TABLE IF NOT EXISTS conversation_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    owner_email TEXT NOT NULL,
    ts TEXT NOT NULL,
    role TEXT NOT NULL,
    tool TEXT,
    is_error INTEGER NOT NULL DEFAULT 0,
    content TEXT,
    meta_json TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversation_entries_owner_ts
    ON conversation_entries(owner_email, ts DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_entries_session
    ON conversation_entries(session_id, id DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS conversation_entries_fts USING fts5(
    content,
    content='conversation_entries',
    content_rowid='id',
    tokenize='porter unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS conversation_entries_ai
    AFTER INSERT ON conversation_entries
BEGIN
    INSERT INTO conversation_entries_fts(rowid, content)
        VALUES (new.id, coalesce(new.content, ''));
END;

CREATE TRIGGER IF NOT EXISTS conversation_entries_ad
    AFTER DELETE ON conversation_entries
BEGIN
    INSERT INTO conversation_entries_fts(conversation_entries_fts, rowid, content)
        VALUES ('delete', old.id, coalesce(old.content, ''));
END;

-- Sandbox workspace snapshots: most recent backup handle per owner.
CREATE TABLE IF NOT EXISTS workspace_snapshots (
    owner_email TEXT PRIMARY KEY,
    backup_id TEXT NOT NULL,
    backup_dir TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Web Push endpoints. Multiple devices per owner.
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    subscription_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_owner
    ON push_subscriptions(owner_email, updated_at DESC);

-- Recurring jobs. Owner-scoped prompts injected on a fixed cadence.
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    cadence_secs INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    next_run_at TEXT NOT NULL,
    last_run_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_jobs_owner_updated
    ON jobs(owner_email, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_due
    ON jobs(status, next_run_at);
