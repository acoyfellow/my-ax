CREATE TABLE IF NOT EXISTS conversation_hooks (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  session_id TEXT NOT NULL,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_conversation_hooks_owner_session ON conversation_hooks (owner_email, session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_hooks_token_hash ON conversation_hooks (token_hash);
