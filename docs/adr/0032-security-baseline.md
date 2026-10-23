---
title: "0032. Security baseline"
description: "The security rules that all code must follow, and the checks that passed."
adr:
  date: 2026-10-20
---

## Context

This record lists the rules that the code must follow. The rules come from security reviews, and each finding has a regression test. The record also lists what the reviews checked and found sound. Later reviews can use it as a baseline.

## Rules

### Output and the DOM

- JSX escaping protects only the text that JSX renders. The browser decodes a value when you read it back from the DOM (`field.value`, `getAttribute`). Never put such a value into `innerHTML`.
- Query parameters reach the DOM this way. Text edits by owners also reach it, and these edits skip moderation. Use `textContent`, `setAttribute` or an escape function.
- A same-origin script can act as the signed-in user, also as a moderator. CSRF Origin checks and `SameSite=Lax` do not stop it.
- JSON inside `<script>` escapes `<`.

### URLs and redirects

- JSX does not block `javascript:` URLs. User-supplied URLs must match `^https?://`.
- `^\/(?!\/)` is not a safe redirect check, because `/\evil.com` and `/<TAB>/evil.com` pass it. Use `new URL(next, origin)` and compare the origin (`safeNext`).

### Files

- Never store or serve the Content-Type that the client sends. Derive it from the extension.
- Serve user files as attachments with `Content-Security-Policy: sandbox; default-src 'none'` and `nosniff`. A `.txt` upload caused a stored XSS.
- Non-Latin-1 names in `Content-Disposition` cause an exception. Use `filename*=UTF-8''`.
- Zip exports use basenames, to prevent zip-slip.
- The code sanitises R2 keys.

### Input

- Validate JSON that the client produces, such as browser check results. Read it defensively.
- Cap repeated parameters, because D1 allows 100 bound parameters.
- Guard `decodeURIComponent`.
- Use bound SQL only. Take `ORDER BY` values from an allow-list.

### Data integrity

- Multi-statement writes use `db.batch`, so they apply all or nothing. They check foreign references first.
- Before you delete a user, re-point every foreign key (`mergeAccounts`, [ADR 0020](/docs/adr/0020-one-account-per-person/)).
- The approval of an old instrument-profile version must not roll back the current version.
- The code adds reciprocal associated-spectrum links only on the contributor's own spectra.

### Accounts

- Tokens are random, and the database stores them as SHA-256 hashes. Tokens include sessions, sign-in links, challenges and drafts tokens.
- Every sign-in path and every form that sends email has a rate limit (`rate_events`).
- Sensitive changes need a sign-in in the last 15 minutes ([ADR 0018](/docs/adr/0018-sign-in/), [0019](/docs/adr/0019-two-step-and-passkeys/), [0021](/docs/adr/0021-admin-account-tools/)).
- Admins cannot mark an address as confirmed ([ADR 0021](/docs/adr/0021-admin-account-tools/)).
- Error details never reach public responses. On the old site, PHP warnings leaked into the API JSON.

### Secrets and personal data

- The repository holds no secrets. Secrets go in `worker/.env`, which git ignores. The committed `.env.example` lists only the names.
- Personal data never enters the repository ([ADR 0011](/docs/adr/0011-migrating-accounts/)).
- Sign-up, submit and contact use Turnstile.
- The site does not accept anonymous submissions. A submission must include a readable file.

## Checked and found sound

The reviews checked these items and found them sound:

- the OAuth state cookie
- `safeNext`
- token hashing
- cookie flags
- bound SQL
- upload serving
- avatar magic-byte checks
- R2 key sanitising
- `<` escaped in script JSON
- http(s)-only user URLs
- CSRF and admin guards.

Before the repository becomes public, check every commit for secrets, a real `database_id`, personal data and password hashes. Password hashes in test fixtures are allowed.
