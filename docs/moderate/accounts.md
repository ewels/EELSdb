---
title: Manage accounts
description: How EELSdb administrators find accounts, fix profiles and email addresses, and help people who are locked out.
---

Administrators can help people who cannot sign in and can fix accounts, on the website.
Moderators do not see these pages. They are for administrators only.

Open **Accounts** from the moderation page. Like all admin pages, they need [two-step sign-in](/docs/moderate/review/#two-step-sign-in-is-required).

## Safety rules

- Every change needs a sign-in in the last 15 minutes. If you signed in earlier, EELSdb asks you to sign in again and repeat the change.
- You cannot use these pages on your own account. Use your own [settings](/docs/share/sign-in/). This also means you can never remove the last administrator.
- You cannot confirm an email address for someone. A confirmed address signs in with an email link, so only the person can confirm it, by opening the link EELSdb sends to the address.
- You never see passwords, authenticator secrets, recovery codes or sign-in links.
- Every change is logged on the account's page, with the time and your name. The person gets an email about changes to how they sign in (see below). It does not name you.

## Messages from the contact form

The [contact form](/contact/) emails every administrator who has two-step sign-in and a confirmed primary email address. The email shows the sender's name and address, the topic, whether they were signed in (with a link to their account page), and the page they came from. Reply to the email: the reply goes to the sender, not to the website.

If no administrator has an address, the message goes to the `CONTACT_EMAIL` setting, when the server has one.

**Messages** on the moderation page lists the last 100 messages, so nothing is lost if an email does not arrive. Each one shows whether the email was sent, and to how many administrators. Messages are deleted after a year. Moderators do not see this page.

## Find an account

The list shows every account, not only those that have signed in. Type part of a name, a username, any email address or an ORCID iD in the search box, or an account number. Administrators and moderators come first. The list has pages of 50.

Click a name to open the account page.

## The account page

- **Profile:** name, username, job title, affiliation, links and whether the profile is public. The same checks apply as in the person's own settings. You can also change their picture to initials or Gravatar, which deletes an uploaded picture, but you cannot upload one for them.
- **Role:** user, moderator or administrator. Staff get a username, so they have an author page.
- **Email addresses:** add one (it stays unconfirmed, and EELSdb sends it a confirmation link), send the confirmation link again, make a confirmed address primary, or remove one that is not the primary. For a confirmed address, **Send sign-in link** emails the person a normal sign-in link. You do not see the link. While email links are [switched off](#sign-in-methods), this button is not there.
- **Sign-in:** linked ORCID, Google and GitHub accounts (you can unlink one), whether a password is set, whether the authenticator app is on and how many recovery codes are left, the passkeys with their last use, and the number of active sessions.
- **Their work:** links to their spectra, submissions and instrument profiles, and the number of drafts. Drafts are visible only to their owner.
- **Merge another account into this one:** see [Merge two accounts](#merge-two-accounts).
- **Log:** what administrators changed on this account.

## Help someone who is locked out

1. Check that the person can open a confirmed address of the account. If they cannot, ask them to confirm who they are, and add the address they can use. They must open its link before it counts.
2. If they lost their phone and recovery codes, or their only passkey, click **Reset two-step sign-in**. It removes the authenticator app, the recovery codes and the passkeys, and signs the person out everywhere.
3. If they forgot their password, they can use an email link. If the password is the problem, click **Remove password**. It also signs the person out everywhere.
4. Click **Send sign-in link** next to a confirmed address, or tell the person to ask for a link on the sign-in page.
5. The person signs in with the link and sets up two-step sign-in or a password again in their settings.

For a moderator or an administrator, the role does nothing until they turn two-step sign-in on again.

## Merge two accounts

Use this when one person has two accounts. The people who sign in with the old-site claim link merge their own accounts without you; this is for the ones that still happen.

1. Open the account to **keep**, and use **Merge another account into this one** to search for the other account (name, username, email address, ORCID iD or account number).
2. Pick it. The confirmation page shows both accounts side by side: names, usernames, roles, email addresses, sign-in methods, recovery codes, sessions, and the numbers of spectra, drafts, submissions, instrument profiles, favourites and tokens. Below it, it lists what moves and what is dropped.
3. Click **Merge the accounts**. This cannot be undone.

The kept account's name, profile, role and username win. If the other account has a higher role, the page says so, and the role is not moved. Change it on the account page afterwards if it should be.

**What moves:** spectra and drafts (with the kept name and username as author), submissions, edit history, instrument profiles, favourites (a spectrum both accounts favourited stays once), draft tokens, the admin log entries about the account and by it, and the email addresses the kept account does not have yet. The other account's linked ORCID, Google and GitHub accounts move, except for a service the kept account already has. All its passkeys move (they are on the person's devices and never conflict). Its password, authenticator app with recovery codes, uploaded picture and ORCID iD move only if the kept account has none of its own, so the kept account's protection is never replaced. The two-step setting "Also ask after ORCID, Google and GitHub" stays on if either account had it.

**Usernames:** if the kept account has no username it takes the other's. Otherwise the other's old author page address redirects to the kept account's.

**What is dropped:** the other account's name, affiliation, country, job title, links and other profile settings, its sessions, pending sign-in links and challenges, and anything listed above that the kept account already has.

**Safety rules:** the same as for every change here (a sign-in in the last 15 minutes, not your own account on either side). If both accounts are administrators, the page asks you to tick a box saying they are the same person. The merge is logged on the kept account with the other account's number and name. The kept account's primary confirmed address and the other account's are both emailed before the other account goes.

## Emails the person gets

EELSdb emails the person's primary confirmed address, with what changed and when, after these changes: an address added or removed, a password removed, two-step sign-in reset, a linked account unlinked, signing out everywhere, a role change, and an account merged into theirs. The merged-away account's address is told too. If the account has no confirmed address, nobody is told, but the change is still logged.

## Site settings

Administrators open **Site settings** from the moderation page (`/admin/settings/`). Changing a setting needs a sign-in in the last 15 minutes, like the account actions. **Recent changes** at the bottom of the page lists who changed what and when.

**Require a linked ORCID iD to submit spectra** is on by default. While it is on, a person whose account has no ORCID sign-in linked cannot submit a new spectrum on the web form, and cannot submit drafts for review. They see why, with a **Link ORCID** button. These do not need an ORCID iD: editing a published spectrum, and making drafts through the API.

The rule applies only when ORCID sign-in is set up on the server. The settings page says so when it is not. An ORCID iD typed into a profile, or migrated from the old site, does not count: only an ORCID sign-in does.

People with no linked ORCID see a banner on every page asking them to link it. They can hide it for 30 days, but on the submit page it stays while the rule is on.

### Two-step sign-in

Three switches decide who must use [two-step sign-in](/docs/share/sign-in/#two-step-sign-in) (an authenticator app or a passkey): administrators (on by default), moderators (on) and all other users (off). Beside each switch the page shows how many accounts in that group have neither.

- **Administrators and moderators, on:** without two-step sign-in the role does nothing (the moderation and admin pages send them to **Settings**, **Two-step and passkeys**), and they are asked for a second step after every way of signing in except a passkey. **Off:** the role works without it. Accounts that have two-step sign-in are then asked for it like any user: after an email link or a password, and after ORCID, Google and GitHub only if they chose **Also ask after ORCID, Google and GitHub**.
- **All other users, on:** a signed-in user without two-step sign-in is sent to **Settings**, **Two-step and passkeys** by every page that needs an account (submitting, drafts, favourites, account and settings pages), until they set it up. Public pages keep working, and so do the **Two-step and passkeys** settings page and sign-out. Their API tokens stop working. Everyone who has two-step sign-in is asked for it after every way of signing in except a passkey. **Off:** users choose for themselves.
- The contact form emails administrators who hold the role: with the administrators switch on, only those with two-step sign-in; with it off, every administrator.

Switching a requirement **on** shows a confirmation page first, with how many accounts have no two-step sign-in and what happens to them. Type that number (or tick the box if it is 0) and confirm. Switching **off** only needs the box unticked. You cannot require it for administrators unless your own account has two-step sign-in, so no one is left unable to change the setting back. Changes appear under **Recent changes**.

### Sign-in methods

One switch for each way to sign in: ORCID, Google, GitHub, passkey sign-in, email links and passwords. All are on by default. Beside each switch the page shows how many accounts can sign in with it. A service that is not set up on the server is unavailable whatever its switch says.

A method that is switched off is off everywhere: it is not on the sign-in page, its pages refuse with a message, the **Sign-in methods** settings page no longer offers to link that service or set a password, and **Send sign-in link** is gone from the account pages. People who are signed in stay signed in until their session ends. Passkeys keep working as the second step, so moderators keep their two-step sign-in.

Above the switches, a warning says how many accounts have no switched-on way to sign in right now.

**Switching a method off locks people out.** An account is locked out when it has none of the methods that stay on: for example, with ORCID only, every account without a linked ORCID iD. These people cannot sign in until an admin switches a method they have back on, or an admin merges their account into one that can sign in. They can link a method that stays on only while they are still signed in. Switching a method back on gives them access again at once.

To switch methods off:

1. Untick them and click **Review and save**. Nothing changes yet.
2. The confirmation page shows, in large text, how many accounts would have no switched-on way to sign in (with only ORCID on: "37 accounts have no linked ORCID iD and would not be able to sign in"), how many have none today, and for each method you switch off how many accounts sign in with it now.
3. If any account would be locked out, type that number to confirm. If none would be, tick the box. Then click **Switch off**.

EELSdb refuses the change, and says why, when:

- every method would be off (or only services that are not set up are left);
- your own account would have no switched-on method it can use. Link one that stays on in your own settings first, for example ORCID before moving to ORCID only.

The counts are saved with the change in **Recent changes**. Switching methods back on needs no confirmation.

#### Moving to ORCID only

1. Ask people to link ORCID while they can still sign in. The banner asks everyone with no linked ORCID iD.
2. Link ORCID to your own account.
3. Untick every method except ORCID, and check the count on the confirmation page.

While ORCID is the only method on, the banner tells people without a linked iD that ORCID is how they sign in, and it cannot be hidden. Someone who signs in with an ORCID iD that matches no account is asked to create the account and contact you to merge their old one into it (see [Merge two accounts](#merge-two-accounts)).
