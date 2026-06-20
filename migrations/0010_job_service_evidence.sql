-- Owns: durable recurring-job mutation/run evidence and idempotency indexes.
-- Called by: src/job-service.ts only.
-- Does not own: schedules, session state, or authentication.
ALTER TABLE jobs ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_owner_idempotency ON jobs(owner_email, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  action TEXT NOT NULL,
  ok INTEGER NOT NULL,
  detail_json TEXT NOT NULL,
  idempotency_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_events_owner_job ON job_events(owner_email, job_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_run_idempotency ON job_events(owner_email, job_id, action, idempotency_key) WHERE idempotency_key IS NOT NULL;
