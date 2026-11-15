CREATE TABLE IF NOT EXISTS domain_refusals (
  day TEXT NOT NULL,
  refusal_key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, refusal_key)
);
