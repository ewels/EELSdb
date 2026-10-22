-- What admins changed on other people's accounts. details_json never holds secrets or password hashes.
CREATE TABLE admin_actions (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES users(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  details_json TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX admin_actions_user ON admin_actions (user_id, at);
