-- Audio Messages: agent-generated TTS clips delivered into a conversation and
-- rendered inline like Svelte artifacts. Clips are owner-scoped, stored in R2,
-- and expire after 7 days. Expiry is enforced on read; physical deletion is a
-- best-effort delete plus an R2 lifecycle rule on the uploads bucket.
CREATE TABLE IF NOT EXISTS audio_messages (
  id           TEXT PRIMARY KEY,
  owner_email  TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  storage_key  TEXT NOT NULL,
  text         TEXT NOT NULL,
  voice        TEXT NOT NULL,
  mime         TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audio_messages_owner_created ON audio_messages(owner_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audio_messages_session ON audio_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_audio_messages_expires ON audio_messages(expires_at);
