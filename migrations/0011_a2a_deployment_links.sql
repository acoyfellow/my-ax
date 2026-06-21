-- A2A 1.0 deployment links. Bearer credentials are never stored in plaintext.
CREATE TABLE IF NOT EXISTS a2a_grants (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  label TEXT NOT NULL,
  remote_origin TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_a2a_grants_owner ON a2a_grants(owner_email, created_at DESC);

CREATE TABLE IF NOT EXISTS a2a_tasks (
  id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES a2a_grants(id),
  owner_email TEXT NOT NULL,
  message_id TEXT NOT NULL,
  message_hash TEXT NOT NULL,
  context_id TEXT NOT NULL,
  text TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'input-required' CHECK(state IN ('input-required','completed','rejected','canceled','failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(grant_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_a2a_tasks_owner ON a2a_tasks(owner_email, created_at DESC);

ALTER TABLE attention_items ADD COLUMN a2a_task_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_attention_a2a_task ON attention_items(a2a_task_id) WHERE a2a_task_id IS NOT NULL;
