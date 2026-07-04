-- Owner-scoped product preferences that must be available to background agents.
CREATE TABLE IF NOT EXISTS owner_preferences (
  owner_email TEXT NOT NULL,
  preference_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_email, preference_key)
);
