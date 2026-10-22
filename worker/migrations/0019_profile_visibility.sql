-- Replaces the single profile_public with one switch per part of a profile: whether to look up the Gravatar picture
-- (an uploaded picture is always shown), and whether to show the details (job title, affiliation) and the links
-- (ORCID iD, web pages, social accounts). Each starts with the old value, so no public picture changes.
ALTER TABLE users ADD COLUMN use_gravatar INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN show_details INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN show_links INTEGER NOT NULL DEFAULT 0;
UPDATE users SET use_gravatar = profile_public, show_details = profile_public, show_links = profile_public;
ALTER TABLE users DROP COLUMN profile_public;
