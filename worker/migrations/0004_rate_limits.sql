-- Failed sign-ins and similar events, for simple per-key rate limits.
CREATE TABLE rate_events (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX rate_events_lookup ON rate_events(kind, key, at);
