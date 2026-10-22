-- Personal tokens that can only create drafts (POST /v2/drafts); the owner submits drafts on the website.
CREATE TABLE draft_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hash TEXT UNIQUE NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
