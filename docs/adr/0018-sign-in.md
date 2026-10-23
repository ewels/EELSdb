---
title: "0018. Sign-in"
description: "Six sign-in methods all end in one function, and ORCID is the first choice."
adr:
  date: 2026-10-14
---

## Context

- Contributors' old accounts must keep working ([ADR 0011](/docs/adr/0011-migrating-accounts/)).
- EELSdb wants to identify contributors by ORCID iD, and may move to ORCID-only sign-in later. We measured this on local data. ORCID-only sign-in would lock out about 396 accounts, which is almost every migrated account. So it needs a linking campaign first.
- Not everyone has or wants ORCID, Google or GitHub.
- A check of an old WordPress password hash uses a lot of CPU. phpass uses 8,192 MD5 rounds, and bcrypt uses cost 12. Cloudflare does not enforce the free plan's 10 ms CPU limit exactly. The project owner runs bcryptjs at cost 12 on the free plan elsewhere without trouble. But heavy hashing can cause error 1102 under load.

## Decision

### Methods

The first step is any one of these methods:

- ORCID, Google or GitHub (OAuth)
- a passkey
- an email link
- an email address or username, and a password

One account can use any mix of methods.

### One completion path

Every method ends in `completeSignIn`. This function does these steps:

- It decides whether a second step is needed ([ADR 0019](/docs/adr/0019-two-step-and-passkeys/)).
- It links a pending identity ([ADR 0020](/docs/adr/0020-one-account-per-person/)).
- It refuses methods that are switched off.
- It sets the session and the "last used" hint.

No sign-in can skip `completeSignIn`.

### Sessions

The session cookie is `eelsdb_session`. The Worker stores the SHA-256 of a random token in `sessions`. A session lasts 30 days. Sensitive changes need a sign-in in the last 15 minutes, measured from `sessions.created_at`.

### Email links

The email link is also the sign-up path. There is no separate sign-up form.

- The page always answers "If this address can sign in, we have sent a link", so it reveals nothing.
- The Worker sends at most 5 links an hour per address and 30 an hour per IP (`rate_events`). Only sent links count towards these limits.
- The token is random. The Worker stores it as SHA-256. It is valid for 15 minutes and works once.
- The emailed link opens a page with a "Sign in" button, and the button sends a POST. Email scanners open links, so a GET must not use up the token. The POST spends the token with one `UPDATE ... RETURNING`, so two clicks cannot both sign in.
- The Worker looks for an account in this order:
  1. the account with that verified address
  2. a migrated account whose old email matches and that has no linked service
  3. if neither exists, it makes a new account

### Passwords

Passwords are optional.

- `users.password_hash` holds a PBKDF2-SHA256 hash with 100,000 iterations, made with Web Crypto. 100,000 is the Workers maximum.
- Sign-in accepts a confirmed email address, the current username or the old-site login. When several accounts match, the Worker prefers the confirmed address, then the username, then the old login.
- The Worker also accepts legacy hashes when `LEGACY_PASSWORD_LOGIN` is on. It accepts two formats:
  - phpass `$P$B…`
  - WordPress 6.8+ `$wp$2y$…`, which is bcrypt over base64(HMAC-SHA384(key `wp-sha384`, trim(password)))

  The Worker checks legacy hashes with bcryptjs, because Web Crypto has no MD5 or bcrypt. On the first successful sign-in, it rehashes the password to PBKDF2 and clears the legacy column.
- After 10 failures in an hour, the Worker locks the login.
- A password must have 10 to 200 characters. There are no other rules. The Worker rejects a password over 200 characters without hashing it.
- There is no reset form. "Forgot your password?" sends an email link.
- To set a first password, the person needs a recent sign-in. Without this rule, anyone at an unattended signed-in browser could add a password and keep access.
- To change or remove a password, the person needs the current password or a recent sign-in. The change signs out other sessions.

### OAuth details

- Each provider has one callback. The state cookie `eelsdb_oauth` holds `state|next|link`.
- After the ORCID token exchange, the Worker reads the record's public addresses from `GET https://pub.orcid.org/v3.0/{iD}/email`, with a 4 s timeout. The sandbox host is `pub.sandbox.orcid.org`.
- The Worker uses the first verified address. If the request fails for any reason, the Worker uses no address and sign-in continues.
- ORCID shares only addresses that the person made public, and only verified ones. Addresses are private by default. "Trusted parties" addresses need the paid member API. So a match on an ORCID address is safe.
- Google and GitHub return verified addresses.
- ORCID can refuse a plain-http localhost callback. For local work, set `ORCID_BASE` to the sandbox.

### Sign-in page

The sign-in page is one narrow panel. From top to bottom, it shows:

1. "Continue with ORCID", the only primary button, with the text "EELSdb credits contributors by their ORCID iD."
2. Google, GitHub and passkey, as secondary buttons.
3. The email field, with passkey autofill (`autocomplete="username webauthn"`), and "Email me a sign-in link".
4. The password fold-out.

The browser keeps the "last used" method name in `localStorage`, and nothing else. The page marks that method with a tag and an accent border. The "last used" method never changes which button is primary. The brand marks are inline SVG and follow each service's rules. Google asks for a neutral button, and the ORCID iD icon stays unaltered.

### Site settings

Admins change site settings at `/admin/settings/`. The values are in the `site_settings` table, and the defaults are in `worker/src/settings.ts`.

- Each method has one switch: `signin_orcid`, `signin_google`, `signin_github`, `signin_passkey`, `signin_email_link` and `signin_password`. All are on by default.
- `methodsFrom(env, settings)` is the one rule for which methods are available. A method must be switched on. A service must also be configured.
- A switched-off method is off everywhere. The page hides it, and its routes refuse it before they do any work. Passkeys still work as a second step.
- The settings must never lock everyone out:
  - At least one method stays on.
  - The acting admin must keep a usable method that is on.
  - An admin can never switch a method off with one click. A confirmation page shows how many accounts would have no way in, and how many accounts use each method. If that count is above zero, the admin types the number.
  - Locked-out accounts are not lost. If an admin switches the method back on, or merges the account, access returns at once.
  - The Worker logs changes in `site_settings_log`.
- "Require a linked ORCID iD to submit" (`require_orcid`) is on by default. A banner asks signed-in people without a linked ORCID iD to link one. This setting does not apply when ORCID sign-in is off or not configured.

## Consequences

- `wayInSql` in `auth.ts` defines who has a way in. The guard and every count use it.
- Usernames stay first-class, because they are the author page address.
- `.env` in `worker/` holds local secrets. It is gitignored, and a committed `.env.example` lists the names. Vitest also loads `.env`. So `vitest.config.ts` pins the Turnstile, email and ORCID bindings, and `test/setup.ts` turns `require_orcid` off for older tests.
- `wrangler dev` does not pick up changes to `.env` until you restart it.

## Alternatives considered

- OAuth only. Not everyone has these services, and migrated accounts need their old passwords.
- Workers Paid for password hashing. EELSdb does not need it at this traffic. The PBKDF2 rehash on first use removes the cost after one sign-in.
