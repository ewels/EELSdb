-- A provider sign-in that matched no account waits here for the person to say whether they have one.
CREATE TABLE pending_identities (
  token_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  name TEXT,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  next TEXT,
  expires_at TEXT NOT NULL
);
