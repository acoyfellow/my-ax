-- Durable owner-scoped attention receipts. Push is delivery; this table is
-- the compact in-app truth for unresolved attention items.
CREATE TABLE IF NOT EXISTS attention_items (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    session_id TEXT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    href TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_attention_items_owner_seen
    ON attention_items(owner_email, seen_at, created_at DESC);
