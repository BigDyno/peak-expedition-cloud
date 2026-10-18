-- Race codes are public identifiers. Secret keys are stored only as SHA-256 hashes.
CREATE TABLE IF NOT EXISTS races (
  code TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  manage_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_races_updated_at ON races(updated_at);
CREATE TABLE IF NOT EXISTS create_limits (
  bucket TEXT PRIMARY KEY NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0
);
