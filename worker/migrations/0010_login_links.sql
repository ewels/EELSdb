-- Sign-in links sent by email: the token is stored as its SHA-256, valid for 15 minutes, used once.
CREATE TABLE login_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  next TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
