ALTER TABLE jobs ADD COLUMN sub TEXT;
CREATE TABLE bindings (
  telegram_user_id TEXT PRIMARY KEY,
  sub TEXT NOT NULL,
  email TEXT NOT NULL,
  bound_at INTEGER NOT NULL
);
CREATE TABLE link_tokens (
  token_hash TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  pending_sub TEXT,
  pending_email TEXT,
  used INTEGER NOT NULL DEFAULT 0
);
