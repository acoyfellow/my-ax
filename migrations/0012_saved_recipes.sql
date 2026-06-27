-- Rename the historical storage table to the product/runtime vocabulary.
ALTER TABLE saved_hammers RENAME TO saved_recipes;
DROP INDEX IF EXISTS idx_saved_hammers_owner_name;
DROP INDEX IF EXISTS idx_saved_hammers_owner_updated;
CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_recipes_owner_name ON saved_recipes(owner_email, name);
CREATE INDEX IF NOT EXISTS idx_saved_recipes_owner_updated ON saved_recipes(owner_email, updated_at DESC);
