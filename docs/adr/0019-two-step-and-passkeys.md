---
title: "0019. Two-step sign-in"
description: "Accounts can add an authenticator app or passkeys, and site settings decide which groups must use them."
adr:
  date: 2026-10-22
---

## Context

Moderators and admins can publish data, change accounts and read contact messages. Their accounts need more protection than a single factor. Ordinary users must be able to opt in. The rule must be a site setting and not fixed in code.

## Decision

### Second-step methods

The second step is an authenticator app (TOTP), a recovery code or a passkey. A passkey used as the first step counts as both steps.

### TOTP

`worker/src/totp.ts` implements TOTP on Web Crypto, with no dependency. It follows RFC 6238 and uses these settings:

- SHA-1, 6 digits and a 30 s step
- one step of tolerance either side
- the same step is never accepted twice

The Worker stores the secret as it is, because HMAC needs it. The set-up page shows the secret as text and as a QR code of the `otpauth://` URI. The person confirms set-up with a code.

The set-up page also shows 10 recovery codes, once. Each code has the form `xxxxx-xxxxx` and uses a 31-letter alphabet. The Worker stores the SHA-256 of the lowercased code.

### QR code

The QR code uses `uqr` 0.1.3. It has the MIT licence, is about 27 kB, is an ES module and has no dependencies. The repo vendors it, and the page imports it on demand. We preferred it to `qrcode-generator`, which is 56 kB and includes Shift-JIS tables, and to `qr`, which is larger. The page works without the QR code.

### Passkeys

- The Worker uses `@simplewebauthn/server`. It runs in workerd, and the tests prove this.
- esbuild bundles `@simplewebauthn/browser` into `public/vendor/`.
- The relying party ID is the request host.
- Passkeys are always discoverable. User verification is required, so a passkey sign-in is two factors. Attestation is "none".
- Each ceremony starts with a POST that returns options and a random token. The Worker stores the token as SHA-256. The token is valid for 5 minutes, works once, and is tied to a kind and a user.
- An account can have up to 20 passkeys.

### When the Worker asks for a second step

- After an email link or a password, the Worker asks every account that has two-step sign-in.
- After ORCID, Google or GitHub, the Worker asks only in two cases. The first is when the account chose "also ask after ORCID, Google and GitHub". The second is when the account's role group requires two-step sign-in.
- After a passkey first step, the Worker never asks.

### Group requirements

Three site settings control the requirement for each group:

- `require_2fa_admin`, on by default
- `require_2fa_moderator`, on by default
- `require_2fa_user`, off by default

The rules for each group:

- Staff without two-step sign-in lose their role while their group requires it. `loadUser` sets their role to `user`, and sets `needs_2fa`, for the whole request. Every `isModerator` check, admin route and file access then denies the role at once. No check needs its own code, so no check can forget it. The stored role does not change, and it returns when they set up two-step sign-in. `/admin/*` sends them to the two-step settings page.
- When the user group requires two-step sign-in, `requireUser` redirects a signed-in user without it to the set-up page. This applies to every page that needs an account, except the set-up pages, email confirmation links and sign-out. Public pages still work. Drafts tokens get a 401 answer.
- To switch a group on, the admin goes through a confirmation page with counts. If the total is above zero, the admin types it.
- The Worker refuses to switch "admins" on unless the acting admin has two-step sign-in. Otherwise nobody could switch it back.
- A switch off saves at once.

### Limits

A challenge allows 5 tries. Wrong codes also share a limit of 10 an hour per account. Wrong passkeys count only towards the challenge's tries, because nobody can guess a passkey.

### Protection of the two-step settings

- To start set-up, or to add or remove a passkey, the person needs a sign-in in the last 15 minutes.
- To make new recovery codes, turn TOTP off or change "also ask after providers", the person needs a current code or a recovery code.

## Consequences

- There is no self-service recovery for a person who loses both their phone and their codes, or their only passkey. An admin resets two-step sign-in for them ([ADR 0021](/docs/adr/0021-admin-account-tools/)).
- If a staff member removes their last passkey or turns off TOTP and has no other second step, they lose their staff powers.
- With the defaults, an admin without two-step sign-in has no admin powers and gets no contact messages. Set up two-step sign-in on the owner's account before deploy.
- The test helper `sessionFor(user, { totp: false })` makes staff without two-step sign-in. By default, the helper gives staff a `user_totp` row.
- We measured this on local data. A requirement for all users would affect about 391 accounts.
