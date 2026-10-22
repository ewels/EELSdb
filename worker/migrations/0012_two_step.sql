-- Two-step sign-in with an authenticator app. A user_totp row with enabled_at NULL is a set-up that has not been confirmed yet.
CREATE TABLE user_totp (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  enabled_at TEXT,
  last_step INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE recovery_codes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX recovery_codes_user ON recovery_codes (user_id);

-- Between the first step and the second: the token is stored as its SHA-256 and the cookie holding it lasts 10 minutes.
CREATE TABLE login_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  next TEXT,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

-- Ask for the second step after ORCID, Google and GitHub too (always asked after an email link or a password).
ALTER TABLE users ADD COLUMN mfa_all_methods INTEGER NOT NULL DEFAULT 0;
