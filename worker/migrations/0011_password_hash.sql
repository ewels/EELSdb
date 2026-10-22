-- PBKDF2 password for email-and-password sign-in; migrated WordPress hashes move here from legacy_password_hash on first use.
ALTER TABLE users ADD COLUMN password_hash TEXT;
