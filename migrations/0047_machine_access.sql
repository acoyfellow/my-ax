ALTER TABLE machines ADD COLUMN approved_at INTEGER;
ALTER TABLE machines ADD COLUMN logged_out_at INTEGER;
ALTER TABLE machines ADD COLUMN last_seen_at INTEGER;
UPDATE machines SET logged_out_at = COALESCE(revoked_at, logged_out_at);
DROP TABLE IF EXISTS machine_pair_codes;
