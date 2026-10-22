-- WebAuthn passkeys. public_key is the COSE key as the authenticator sent it, base64url.
CREATE TABLE passkeys (
  credential_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX passkeys_user ON passkeys (user_id);

-- One row per ceremony in progress; the token is stored as its SHA-256 and spent once. user_id is NULL for a first-step
-- sign-in, where the passkey says who the person is.
CREATE TABLE webauthn_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('register', 'sign_in', 'second_step')),
  expires_at TEXT NOT NULL
);
