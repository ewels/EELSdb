---
title: "0011. Migrating accounts"
description: "We keep real accounts, drop spam, and keep all personal data out of the repository."
adr:
  date: 2026-10-20
  implemented: partly
---

## Context

The old site had 2,722 accounts. About 2,185 of them were spam bots. The dead reCAPTCHA v1 let them in, and every anonymous submission created an account. All 1,877 pending spectra were spam, and none of them had a data file. Real usage was small:

- 84 users kept favourites.
- 11 users saved microscope presets.
- Spectra had 0 comments.
- The forum had 5 real topics in total.

The live database dump contains emails, password hashes and addresses. The dump lives outside the repository.

## Decision

Personal data never enters the repository. Only scripts that are explicitly about accounts read the dump. At present this is `python/export_accounts.py`. These scripts write their output to `data/private/`, which is gitignored. They log counts and never rows. We commit nothing derived from the dump except aggregate counts. `*.sql` is gitignored.

We keep, review or drop each account by these rules:

| Group | About | Rule | Action |
|---|---|---|---|
| Contributors and admins | 49 | admin role, owns a spectrum, or a forum post before 2024 | keep |
| Older accounts | 346 | registered before 2024, no spam pattern | keep |
| Newer, with favourites | 17 | registered 2024+, has favourites | review |
| Newer, no activity | 125 | registered 2024+, normal-looking name | review |
| Spam | 2,185 | display name of two random mixed-case strings, or a forum post from 2024+, or only spam submissions | drop |

The "random name" test is `binary display_name regexp '^[A-Za-z]{6,} [A-Za-z]{6,}$' and binary display_name regexp '[a-z][A-Z]'`.

For each kept account, we migrate these data:

- The display name, affiliation and country.
- The ORCID iD, if set.
- The login name and email. The site uses them for matching only and never exposes them.
- Favourites and microscope presets.
- Password hashes, but only for legacy password sign-in ([ADR 0018](/docs/adr/0018-sign-in/)).

We do not migrate pending spectra, the forum, jobs, comments, sessions, security-plugin tables, profile-plugin tables, saved browse filters, page size or social links.

The new site drops the forum, the jobs board, comments and the registered-users list. News stays as a frozen archive.

A person takes over old spectra in this way. The person signs in by any method and confirms the old email address under Settings. The site then merges the migrated account into the person's account ([ADR 0020](/docs/adr/0020-one-account-per-person/)). Most people need to do nothing. An email link or their old password signs them straight into the old account.

## Consequences

- The export script is built and runs locally. The accounts reach the live site only at the cut-over ([ADR 0010](/docs/adr/0010-migrating-public-data/)), after a final export from the read-only old site.
- The data worth keeping is, in order: spectrum ownership (the main reason), favourites, presets (marginal) and affiliation for profiles. Attribution of spectra does not need accounts.
- The dump creates its own database name when you load it. The script detects the database that holds the WordPress tables.
- The dump stores favourites as one row per spectrum, not as a serialised list.
- Agent permission checks block reading the dump unless the owner asks directly. This is intended.
- The local D1 holds the migrated real accounts. Never print rows from `users`, `user_emails` or `identities`. Use made-up test users and delete them afterwards.
- Never give a local test user a real person's email. When the site renders the avatar, it sends the email hash to Gravatar.
- Before you share the local site remotely, reseed it without accounts and turn legacy password sign-in off.

## Research: matching old accounts to ORCID (2026-10-22)

- ORCID search matches only the emails that the researcher made public. The paid member API does not change this. ORCID sign-in returns no email unless the person made one public.
- We ran a spike at one request per second, with the owner's approval. Its output is gitignored. The spike checked 41 contributors with published spectra. 3 matched on a public email, and 3 more matched on name plus institution. The others gave weak matches or none.
- Only about 3 of about 395 migrated accounts had a saved ORCID iD. Nobody verified these iDs, so anyone could type a supervisor's iD.
- We decided against automatic linking by ORCID email or by stored iD. Linking needs proof from both sides. We link likely matches by hand after the person confirms.
