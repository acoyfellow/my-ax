-- Notifications redesign (B-C2): let the owner clear failed runs from the
-- notifications stream. A dismissed run is hidden from the stream but the run
-- row + receipt are preserved (reversible, non-destructive).
ALTER TABLE runs ADD COLUMN dismissed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_runs_owner_dismissed ON runs (owner_email, dismissed_at);
