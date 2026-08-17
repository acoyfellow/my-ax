ALTER TABLE attention_items ADD COLUMN notification_tag TEXT;

CREATE TABLE IF NOT EXISTS push_progress_updates (
  owner_email TEXT NOT NULL,
  tag TEXT NOT NULL,
  last_sent_at TEXT NOT NULL,
  PRIMARY KEY (owner_email, tag)
);

CREATE TABLE IF NOT EXISTS push_dismissals (
  owner_email TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner_email, tag)
);

CREATE INDEX IF NOT EXISTS idx_push_dismissals_owner_created
  ON push_dismissals(owner_email, created_at ASC);
