CREATE TABLE IF NOT EXISTS machines (
  owner_email TEXT NOT NULL,
  name TEXT NOT NULL,
  credential_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (owner_email, name)
);

CREATE TABLE IF NOT EXISTS machine_pair_codes (
  code_hash TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
