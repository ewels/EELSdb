-- Old per-user microscope presets, kept until instrument profiles replace them.
ALTER TABLE users ADD COLUMN legacy_presets_json TEXT;

-- Pending "claim your old account" requests: a signed-in user asks to link a legacy account by its email.
CREATE TABLE account_claims (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legacy_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX users_legacy_email ON users(legacy_email COLLATE NOCASE);
CREATE INDEX favourites_spectrum ON favourites(spectrum_id);
CREATE INDEX sessions_user ON sessions(user_id);
