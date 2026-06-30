-- Codemode snippets projection table.
--
-- Additive native-codemode storage seam. Existing saved_recipes rows remain
-- authoritative for owner curation / REST / approval gating. cm_snippets is
-- a dual-read projection that records the codemode-native shape (script,
-- inputSchema, connectors, savedAt) alongside a `source_recipe_id` link
-- back to the saved_recipes row a projection was derived from, and a
-- `codemode_execution_id` that is either:
--   - synthetic (`cm_synth_<recipe_id>`) for transition rows projected from
--     a saved_recipes row that never ran through createCodemodeRuntime; or
--   - the real CodemodeRuntime execution id once a native run promotes it.
--
-- The synthetic id is deliberately distinguishable so receipts/check-in can
-- name it as a transition projection rather than fake an execution log.
--
-- Backfill of currently enabled saved_recipes rows is performed in
-- application code (idempotent INSERT OR IGNORE) so the migration stays
-- minimal/portable across environments where ATTACH is not available.
CREATE TABLE IF NOT EXISTS cm_snippets (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    code TEXT NOT NULL,
    input_schema_json TEXT NOT NULL,
    connectors_json TEXT NOT NULL,
    saved_at INTEGER NOT NULL,
    source_recipe_id TEXT,
    codemode_execution_id TEXT NOT NULL,
    provenance TEXT NOT NULL DEFAULT 'projected',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cm_snippets_owner_name ON cm_snippets(owner_email, name);
CREATE INDEX IF NOT EXISTS idx_cm_snippets_owner_saved_at ON cm_snippets(owner_email, saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_cm_snippets_source_recipe ON cm_snippets(source_recipe_id);
