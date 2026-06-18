-- One-time-use ledger for short-lived connector bridge tickets.
CREATE TABLE IF NOT EXISTS bridge_ticket_uses (
    jti TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bridge_ticket_uses_expiry
    ON bridge_ticket_uses(expires_at);
