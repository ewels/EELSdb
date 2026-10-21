-- A user's email addresses. Sign-in services and the old site's account fill this in; users add more.
CREATE TABLE user_emails (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  verified INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, email)
);
CREATE UNIQUE INDEX user_emails_one_primary ON user_emails(user_id) WHERE is_primary = 1;
-- A verified address finds its account at sign-in, so it can belong to only one.
CREATE UNIQUE INDEX user_emails_verified ON user_emails(email) WHERE verified = 1;

CREATE TABLE email_verifications (
  token_hash TEXT PRIMARY KEY,
  email_id INTEGER NOT NULL REFERENCES user_emails(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark'));
-- An uploaded picture in R2; without one the avatar comes from Gravatar.
ALTER TABLE users ADD COLUMN avatar_key TEXT;

INSERT OR IGNORE INTO user_emails (user_id, email, verified)
  SELECT user_id, lower(trim(email)), MAX(email_verified) FROM identities
  WHERE email IS NOT NULL AND trim(email) != '' GROUP BY user_id, lower(trim(email));
INSERT OR IGNORE INTO user_emails (user_id, email)
  SELECT id, lower(trim(legacy_email)) FROM users WHERE legacy_email IS NOT NULL AND trim(legacy_email) != '';
UPDATE user_emails SET is_primary = 1 WHERE id = (
  SELECT e.id FROM user_emails e WHERE e.user_id = user_emails.user_id ORDER BY e.verified DESC, e.id LIMIT 1
);

-- Optional public profile: job title, and links to the user's other profiles (see src/pages/profile.ts).
ALTER TABLE users ADD COLUMN job_title TEXT;
ALTER TABLE users ADD COLUMN links_json TEXT;
ALTER TABLE users ADD COLUMN profile_public INTEGER NOT NULL DEFAULT 0;

-- Usernames a user had before, so their old /author/ addresses keep working.
CREATE TABLE user_slug_history (
  slug TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
