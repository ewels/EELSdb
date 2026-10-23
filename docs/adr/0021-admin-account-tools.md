---
title: "0021. Admin account tools"
description: "Admins can fix locked-out and duplicate accounts, under strict safety rules."
adr:
  date: 2026-10-22
---

## Context

People get locked out, for example after they lose a phone or an old address. Duplicate accounts happen. Admins need to help these people on the website. These tools are also the most dangerous part of the site. A person with an admin session, or at an admin's open browser, could take over any account.

## Decision

### Tools

The tools are in `worker/src/admin-users.tsx`, under `/admin/users/`. Only admins can use them. Moderators get a 403.

- An admin can search by name, username, ORCID iD, account number and any email address, including the old-site address. The results show 50 a page, with staff first.
- Each user has a user page. It shows what the person sees in their settings, and also facts about sign-in. It never shows secrets. It shows these items:
  - profile fields, which the admin can edit with the same code as the user's own settings
  - the role
  - the licence the person agrees to when they submit ([ADR 0023](/docs/adr/0023-licences/))
  - email addresses, with actions to add, remove, make primary and resend confirmation
  - linked services, with an unlink action
  - whether a password is set, with a remove action
  - the two-step status and the number of recovery codes left
  - passkeys
  - active sessions, with a "sign out everywhere" action
  - links to the person's spectra and submissions
  - the number of drafts, and nothing else about drafts
- "Reset two-step sign-in" deletes TOTP, the recovery codes and the passkeys. "Remove password" removes the password. Both actions sign the person out. The person then signs in with an email link to a confirmed address. "Send a sign-in link" sends the normal email, so the admin never sees the token.
- "Merge another account into this one" starts with a search. A confirmation page then shows what moves and what the merge drops ([ADR 0020](/docs/adr/0020-one-account-per-person/)). `mergePlan` builds this page from the same facts that `mergeAccounts` uses. A merge of two admin accounts needs an extra checkbox.

### Safety rules

- Every action needs a sign-in in the last 15 minutes. Admins already need two-step sign-in ([ADR 0019](/docs/adr/0019-two-step-and-passkeys/)).
- An admin cannot act on their own account, and must use their own settings instead. So an admin can never lower the last admin's role. The one exception is the licence: an admin can set their own on their profile settings, because no safety rule depends on it and a second account would get around the rule anyway. Their own change is logged but not emailed.
- Admins cannot mark an address as confirmed. A confirmed address can sign in by email link, so this action would let an admin take over any account.
- Some changes affect sign-in:
  - an address is added or removed
  - the password is removed
  - two-step sign-in is reset
  - a service is unlinked
  - the person is signed out everywhere
  - the role changes
  - accounts are merged
  - the licence changes (this does not affect sign-in, but the person must know which licence they agree to)

  After each of these changes, the Worker emails the person's primary confirmed address. The email says what changed and when, in UTC. It never names the admin. When an admin removes an address, that address gets the notice. When an admin adds an address, the new address gets the normal confirmation link, with the words "Someone added this address…".
- The Worker logs every change in `admin_actions`. `details_json` holds field names, addresses, the provider, roles before and after, and counts. It never holds the values of secrets or hashes.
- The Worker logs site settings changes in `site_settings_log`, with lock-out counts.

## Consequences

- The unlink action has no guard against an account with no way in. The person can still use an email link to a confirmed address, and an admin can send one.
- Moderators keep only the moderation pages.
