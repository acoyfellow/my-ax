CREATE TABLE IF NOT EXISTS cycle_costs (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  session_or_run_id TEXT NOT NULL,
  cycle_index INTEGER NOT NULL,
  ts TEXT NOT NULL,
  model TEXT,
  finish_reason TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  usage_basis TEXT NOT NULL DEFAULT 'ai_sdk_usage',
  recipes_used_json TEXT NOT NULL DEFAULT '[]',
  recipes_saved_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_cycle_costs_owner_session_cycle
  ON cycle_costs(owner_email, session_or_run_id, cycle_index);

CREATE INDEX IF NOT EXISTS idx_cycle_costs_owner_ts
  ON cycle_costs(owner_email, ts DESC);
