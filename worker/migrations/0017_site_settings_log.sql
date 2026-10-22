-- Every change to site_settings, with the lock-out counts the admin saw when switching sign-in methods off.
CREATE TABLE site_settings_log (
  id INTEGER PRIMARY KEY,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  changes_json TEXT NOT NULL,
  details_json TEXT
);
