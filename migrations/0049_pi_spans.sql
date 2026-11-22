CREATE TABLE IF NOT EXISTS pi_spans (
  span_id     TEXT PRIMARY KEY,
  trace_id    TEXT NOT NULL,
  parent_id   TEXT,
  owner_email TEXT NOT NULL,
  chat_id     TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'my-ax',
  name        TEXT NOT NULL,
  phase       TEXT,
  task_name   TEXT,
  tool_name   TEXT,
  model       TEXT,
  status      TEXT NOT NULL,
  error       TEXT,
  started_ms  INTEGER NOT NULL,
  dur_ms      INTEGER NOT NULL,
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  cost_usd    REAL
);
CREATE INDEX IF NOT EXISTS idx_pi_spans_owner_time ON pi_spans(owner_email, started_ms);
CREATE INDEX IF NOT EXISTS idx_pi_spans_owner_chat_time ON pi_spans(owner_email, chat_id, started_ms);
