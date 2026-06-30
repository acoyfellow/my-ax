-- Additive recipe gate status. Existing enabled and disabled rows remain valid.
-- New promotions default to pending in application code until the owner approves.
CREATE INDEX IF NOT EXISTS idx_saved_recipes_owner_status_updated
  ON saved_recipes(owner_email, status, updated_at DESC);
