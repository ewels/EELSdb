---
title: "0020. One account per person"
description: "EELSdb links services to one account, asks before it creates an account, and merges duplicates."
adr:
  date: 2026-10-22
---

## Context

EELSdb has six sign-in methods ([ADR 0018](/docs/adr/0018-sign-in/)). So the same person can easily get two accounts, for example one from an email link and another from ORCID. ORCID rarely shares an email address, so the Worker cannot match ORCID sign-ins to existing accounts by address. Migrated accounts must also reach their owners ([ADR 0011](/docs/adr/0011-migrating-accounts/)).

## Decision

### Linking a service to the signed-in account

Only a signed-in person can use `GET /auth/{provider}/link`. It marks the OAuth state as a link. The callback then adds the identity to the current account. It does not make a new session or ask for a second step.

The callback refuses the link in these cases:

- The identity belongs to another account.
- This account already has a different account of that provider.
- The provider returns an error.

An account can link one account per service. A linked ORCID iD replaces `users.orcid`.

### Source of ORCID iDs

An ORCID iD comes only from a sign-in with ORCID or a link to ORCID. The profile form has no ORCID field. Old typed values stay in the column, because the frozen API v1 `registered-users` reads them. Author pages and metadata show only a linked iD.

### No hidden duplicates

Sometimes a provider sign-in matches no linked identity, no verified address and no unclaimed old account. The Worker then does not make an account. It keeps the identity for 15 minutes in `pending_identities`, with the HttpOnly cookie `eelsdb_pending`. It then asks: "Have you signed in here before?"

- "No, create a new account" makes the account and signs the person in. If the service shared no confirmed address, the new account then goes through an email step. The step has no skip button, by the owner's decision. The page never blocks a person who leaves through the address bar.
- "Yes" goes to the sign-in page. The next successful sign-in in that browser, by any method, links the pending identity after any second step.
- Sometimes the pending service is the only method that is switched on. The page then tells the person to create the account and ask an admin to merge.

### Taking over a migrated account

A migrated account with no linked service can be taken over by email. When a signed-in person confirms an email address that belongs to such an account, the Worker merges that account into the signed-in one. The signed-in profile wins. If the migrated account has a higher role, the role carries over.

Some spectra are still owned by an unmerged old account. Their pages show the uploader's address masked, as the first letter and the domain. This tells people which address to add.

### Merging

`mergeAccounts(db, fromId, intoId)` in `worker/src/merge.ts` does the merge in one `db.batch`, all or nothing. Email confirmation and the admin merge ([ADR 0021](/docs/adr/0021-admin-account-tools/)) both use it. It applies these rules:

- It deletes the merged-away account's sessions, challenges and sign-in links.
- It moves these items to the kept account:
  - email addresses (a shared address stays once, and is confirmed if either copy was)
  - identities, except a provider that the kept account already has
  - all passkeys (they are per device, so they never conflict)
  - drafts tokens
  - spectra, with their author fields
  - submissions, history and instruments
  - admin logs and settings logs
  - contact messages
  - username history
- The kept account's values win for the authenticator secret, recovery codes, password, name, profile, theme and role.
- It fills the avatar and the ORCID iD from the merged-away account if the kept account has none.
- `mfa_all_methods` gets the larger of the two values.
- It copies favourites with `INSERT OR IGNORE`.
- It adds the merged-away username to `user_slug_history`, so the old author address redirects.

When you add a table that references `users`, add its rule to `mergeAccounts`. To find these tables, grep `REFERENCES users` in `worker/migrations/`. Never delete a user directly. The cascade drops their rows without a warning.

## Alternatives considered

- A separate "claim your old account" flow, with its own form, email, rate limit and table. A confirmed address proves ownership equally well, with far less code.
- Create provider accounts at once and merge them later. This leaves duplicates that only an admin can fix.
