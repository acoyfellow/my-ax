-- One owner should never store the exact same artifact source more than once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_owner_source_hash
  ON artifacts(owner_email, source_hash);
