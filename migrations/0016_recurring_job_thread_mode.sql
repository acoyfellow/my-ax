-- Owns: explicit recurring-job conversation targeting policy.
-- Existing jobs keep the historical behavior: every tick continues the stored session.
ALTER TABLE jobs ADD COLUMN thread_mode TEXT NOT NULL DEFAULT 'same_session';
