CREATE TABLE IF NOT EXISTS traveler_phone_link_challenges (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  user_id TEXT NOT NULL REFERENCES marketplace_users(id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL CHECK (length(phone_e164) BETWEEN 8 AND 16),
  code_hash TEXT NOT NULL CHECK (length(code_hash) = 64),
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_traveler_phone_link_expiry
  ON traveler_phone_link_challenges (expires_at);
