-- Per-conversation style: how the agent talks to the owner in text and voice.
-- Rollback: ALTER TABLE sessions DROP COLUMN convo_style;
ALTER TABLE sessions ADD COLUMN convo_style TEXT NOT NULL DEFAULT 'standard';
