ALTER TABLE jobs ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN recurring_fire_key TEXT;
ALTER TABLE jobs ADD COLUMN recurring_fire_verifier_hash TEXT;
ALTER TABLE jobs ADD COLUMN recurring_fire_state TEXT;
ALTER TABLE jobs ADD COLUMN recurring_fire_scheduled_at TEXT;
ALTER TABLE jobs ADD COLUMN recurring_submission_id TEXT;
ALTER TABLE jobs ADD COLUMN recurring_fire_target_session_id TEXT;
ALTER TABLE jobs ADD COLUMN recurring_receipt_id TEXT;
CREATE INDEX IF NOT EXISTS idx_jobs_recurring_submission ON jobs(recurring_submission_id) WHERE recurring_submission_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS recurring_schedule_cancellations (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  session_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(owner_email, session_id, schedule_id)
);
CREATE INDEX IF NOT EXISTS idx_recurring_schedule_cancellations_job ON recurring_schedule_cancellations(job_id, owner_email);
CREATE INDEX IF NOT EXISTS idx_recurring_schedule_cancellations_session ON recurring_schedule_cancellations(session_id, owner_email);
