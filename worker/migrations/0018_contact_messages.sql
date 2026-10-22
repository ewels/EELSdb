-- Messages from the contact form, kept so nothing is lost if email fails. Deleted after a year by the daily cron.
CREATE TABLE contact_messages (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  topic TEXT NOT NULL,
  message TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  page TEXT,
  status TEXT NOT NULL,
  recipients INTEGER NOT NULL DEFAULT 0,
  delivered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX contact_messages_created ON contact_messages (created_at);
