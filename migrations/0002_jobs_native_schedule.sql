-- Jobs use agents' native per-DO scheduleEvery alarm rows.
-- D1 stays as a thin owner/session UI index; schedule_id lets REST routes
-- cancel/resume the native alarm without a global cron scan.
ALTER TABLE jobs ADD COLUMN schedule_id TEXT;
