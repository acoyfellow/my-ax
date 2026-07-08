-- Push notification de-duplication.
--
-- notifyOwner() accepted a `dedupeKey` from callers (recurring-job receipts,
-- dead-session rechecks, delegate receipts) but NEVER used it, so the same
-- logical event fired a fresh Web Push on every recheck/tick. Repeated sends
-- to the same subscription made the push provider (APNs/FCM/Mozilla autopush)
-- return 429 Too Many Requests. Recording the dedupe key lets notifyOwner
-- suppress a resend of the same event within a short window.
--
-- Rollback: DROP INDEX idx_attention_dedupe; ALTER TABLE attention_items DROP
-- COLUMN dedupe_key; (additive + nullable, so a pre-0019 worker ignores it.)
ALTER TABLE attention_items ADD COLUMN dedupe_key TEXT;

CREATE INDEX IF NOT EXISTS idx_attention_dedupe
  ON attention_items(owner_email, dedupe_key, created_at DESC);
