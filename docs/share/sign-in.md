---
title: Sign in and link your old account
description: Sign in to EELSdb with ORCID, Google, GitHub, a passkey, an email link or a password, and link an account from the old EELSdb site.
---

You need an account to submit spectra and to keep favourites.
You do not need one to browse or download.

## Sign in

1. Click **Sign in** in the site header.
2. Click **Continue with ORCID** (the first button), **Continue with Google**, **Continue with GitHub** or **Sign in with a passkey** (see [Passkeys](#passkeys)). Or, under the "or" line, type your email address and click **Email me a sign-in link**, or open **Sign in with a password**.
3. With a service, accept the request on the service's site. With an email link, EELSdb shows **Check your email**. Open the email, click the link and then click **Sign in** on the page that opens.

EELSdb then returns you to the page you came from.

ORCID comes first because EELSdb credits contributors by their ORCID iD. Signing in with ORCID links your iD to your account, so your spectra are credited to it.

### Some ways may be switched off

The administrators can switch each way of signing in on or off. The sign-in page shows only the ways that are on. If a way you used before is switched off, the page says so: sign in another way that your account has. EELSdb may later move to ORCID sign-in only, so linking your ORCID iD now (see [below](#link-orcid-google-or-github)) keeps your account reachable.

If the only way left is ORCID and your account has no linked ORCID iD, the banner at the top of each page says so and cannot be hidden. Link ORCID while you are still signed in. If you are already signed out, [contact us](/contact/) to have your old account merged into a new ORCID one.

A passkey still works as your [second step](#two-step-sign-in) when passkey sign-in is switched off.

### First time with ORCID, Google or GitHub

If you sign in with ORCID, Google or GitHub and EELSdb does not know you yet, it does not make an account at once. It asks **Have you signed in here before**, naming the other ways in that are switched on. This stops a second account being made for you.

- **No, create a new account** makes your account, and you are signed in.
- **Yes, sign in to my account** takes you to the sign-in page. Sign in your usual way: an email link, a password, a passkey or another service. EELSdb then links the service you just used to that account. If the account has [two-step sign-in](#two-step-sign-in), the link is added only after you pass the second step.
- You have 15 minutes. After that, or if you give up, nothing is linked and no account is made.
- If that ORCID, Google or GitHub account is already linked to a different EELSdb account, or your account already has a different one of that kind, nothing is linked, and Settings says so.
- If the service you used is the only way in that is switched on, there is nothing else to sign in with. The page says: "If you used EELSdb before with another sign-in, create this account and ask us to merge them". Click **Create my account**, then [contact us](/contact/).

EELSdb knows your account already when the service gives an email address that you confirmed on your account, or the address of an unclaimed old account. ORCID gives an address only if you made it public on your ORCID record and verified it. A private address cannot be used. If you cannot tell which account is yours, ask for an email link to your usual address.

The sign-in page marks the way you used last in this browser with **Last used** and a coloured border. **Continue with ORCID** stays the main button. With a password, the password form is open when you come back. EELSdb keeps only the name of the method in the browser, not your address, and the other ways stay on the page.

### Email links

There is no separate sign-up: if no account uses your address, the first link you open makes one.
Your name starts as the part of the address before the @, and you can change it in settings.

- A link works for 15 minutes and only once. If it has expired or was used, the page offers to send a new one.
- The sign-in page gives the same answer for every address, so it does not tell anyone who has an account.
- You can ask for at most 5 links an hour for one address.
- The extra **Sign in** click is there on purpose: some email programs open every link to scan it, and that must not use up your link.
- If the address belongs to your old EELSdb account, the link signs you in to that account (see below).

### Email and password

A password is optional.
Open **Sign in with a password** on the sign-in page and type any confirmed email address of your account, or your username, and your password.
Your username is the one in the address of your author page (you can change it in **Settings**). Accounts from the old site can also use their old-site username.
After 10 wrong passwords for the same address or username within an hour, EELSdb stops accepting passwords for it for an hour.
The error message does not say whether the account exists.

- To set a password, sign in with an email link, open **Settings** and use **Password**. A password needs 10 to 200 characters and has no other rules.
- To change or remove it, type your current password, unless you signed in in the last 15 minutes.
- Changing or removing your password signs you out on every other browser and device.
- If you forget it, click **Forgot your password?** and ask for an email link, then set a new password in **Settings**. There are no separate password sign-up or reset forms.

### Two-step sign-in

You can protect your account with a code from an authenticator app (for example an app on your phone, or a password manager that makes one-time codes).

1. Open **Settings** and find **Two-step sign-in**. You need to have signed in in the last 15 minutes.
2. Click **Set up two-step sign-in**. Scan the QR code with your authenticator app, or type the secret under it into the app. The secret and a link are there too, if the QR code does not show.
3. Type the code that the app shows and click **Turn on two-step sign-in**.
4. EELSdb shows 10 recovery codes once. Save them somewhere safe, such as your password manager. Each one works once, if you lose your phone.

After this, a sign-in with an email link or a password has a second step: EELSdb asks for the code from your app, or for a recovery code.
You have 5 tries for each sign-in, and EELSdb stops accepting codes for your account for an hour after 10 wrong ones.
A code works once, so wait for the next code if you just used one.

- If you also have a [passkey](#passkeys), you can use it instead of a code at the second step.
- Signing in with ORCID, Google or GitHub does not ask for a code, unless you tick **Also ask after ORCID, Google and GitHub**.
- To make new recovery codes, or to turn two-step sign-in off, type a current code or a recovery code. New recovery codes replace the old ones.
- [Moderators and administrators](/docs/moderate/review/#two-step-sign-in-is-required) must use two-step sign-in (an authenticator app or a passkey) while the site requires it for their group, which it does by default. Their role does not work without it, and they are asked for a code after ORCID, Google and GitHub too.
- An administrator can also require two-step sign-in for everyone else. If they do, you are sent to the two-step part of **Settings** whenever you open a page that needs your account (submitting, drafts, favourites and your account pages) until you set it up. Public pages keep working. Drafts tokens do not work until you have set it up, and you are asked for a code after every way of signing in except a passkey.
- If you lose both your phone and your recovery codes, or your only passkey, ask an administrator through the [contact page](/contact/). After they reset your two-step sign-in, you sign in with an email link to a confirmed address and set it up again. They can only do this for an account whose confirmed address you can still open.

### Passkeys

A passkey lets you sign in with your device's fingerprint, face or screen lock, or with a security key, instead of an email link or a password.
It is more secure than a password, because there is no secret to type or to steal in a fake page.
A passkey sign-in is complete by itself: EELSdb does not ask for a second step.

1. Open **Settings** and find **Passkeys**. You need to have signed in in the last 15 minutes.
2. Type a name that tells you which device it is, such as "Laptop", and click **Add a passkey**.
3. Follow your browser's prompt. A phone, a password manager or a security key can hold the passkey.

To sign in, click **Sign in with a passkey** on the sign-in page and choose your passkey. Many browsers also offer it in the email address field.
The list in **Settings** shows when each passkey was added and last used. To remove one, you need to have signed in in the last 15 minutes.

- A passkey is also a second step. If you have a passkey but no authenticator app, a sign-in with an email link or a password ends with **Use a passkey**. If you have both, you choose a code or a passkey.
- A passkey counts as two-step sign-in for [moderators and administrators](/docs/moderate/review/#two-step-sign-in-is-required). If you remove your last passkey, and have no authenticator app, your moderator role stops working until you add one.
- Keep a second way in: another passkey on another device, an authenticator app with its recovery codes, or an email address you can still open.

Making or revoking a [drafts token](/docs/share/drafts/) also needs a sign-in in the last 15 minutes. If your sign-in is older, sign in again first.

With ORCID, Google or GitHub, EELSdb receives your name and email address from the service. It never sees those passwords.

## Link ORCID, Google or GitHub

You can link ORCID, Google or GitHub to the account you are signed in with, and then use it to sign in.

1. Open your [settings](/account/settings/) and go to **Sign-in methods**.
2. Click **Link ORCID**, **Link Google** or **Link GitHub**, and approve the request at the service.
3. You return to your settings. Your account is the same one: linking does not sign you in again or make a new account.

If the service is already linked to a different EELSdb account, nothing changes and the page tells you. If that is your account from the old site, use [the claim steps below](#link-an-account-from-the-old-site).

Linking ORCID sets the ORCID iD on your profile to the one ORCID confirmed. Typing an ORCID iD into your profile does not count as linked: EELSdb counts only an iD that you confirmed by signing in with ORCID. While you have no linked ORCID, a banner at the top of each page offers to link it. You can hide it for 30 days. EELSdb may also [require a linked ORCID iD to submit](/docs/share/submit/#orcid-id).

## Link an account from the old site

The old EELSdb site (before 2026) had its own user names and passwords.
Your old account holds your favourites and the spectra you submitted, and you can link it to your new sign-in.

- If you ask for an email link to the address of your old account, EELSdb signs you in to the old account.
- If you sign in with Google or GitHub and the provider gives the same email address as your old account, EELSdb links the two accounts automatically.
- If you sign in with ORCID, or with a different email address:
  1. Open your [account page](/account/).
  2. Under **Claim your account from the old site**, type the email address of your old account and click **Send link**.
  3. Open the link in the email while you are signed in. The link works for a limited time.

EELSdb gives the same answer whether or not an old account uses the address, so the form does not tell anyone who is a member.

Where the old-site passwords are still accepted, you can also sign in with the same **Sign in with a password** form, using your old user name (or email address) and old password.
After you sign in once, EELSdb stores the password in its new format and forgets the old one.

## Set up your profile

Open **Settings** from your [account page](/account/) to:

- change the name that EELSdb shows beside your spectra, and the username in the address of your author page;
- add your job title, affiliation, ORCID iD and links to your GitHub, Bluesky, Mastodon or other profiles;
- make your profile public, so that your author page shows these details;
- add a picture;
- add more email addresses and choose the main one;
- set, change or remove a password;
- turn on two-step sign-in, and add passkeys;
- see the sign-in methods linked to your account.

The light and dark mode button in the site header saves your choice to your account while you are signed in.

Your author page lists the spectra you contributed, also when your profile is not public.
